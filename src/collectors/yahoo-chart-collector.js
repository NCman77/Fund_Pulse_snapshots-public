const ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const PROVIDER = 'yahoo-finance';
const ENDPOINT_TYPE = 'chart';
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MILLISECONDS = 750;
const DEFAULT_MAX_RETRY_DELAY_MILLISECONDS = 5_000;
const DEFAULT_RETRY_JITTER_RATIO = 0.25;
const DEFAULT_MAX_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MILLISECONDS = 20_000;

class YahooCollectorError extends Error {
  constructor(message, details = {}) {
    super(message, { cause: details.cause });
    this.name = 'YahooCollectorError';
    this.errorClass = details.errorClass || 'collector_error';
    this.httpStatus = Number.isInteger(details.httpStatus) ? details.httpStatus : null;
    this.schemaStatus = details.schemaStatus || 'not_checked';
    this.retryable = Boolean(details.retryable);
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function localDate(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date)
    .filter(({ type }) => type !== 'literal');
  return `${parts.find(({ type }) => type === 'year').value}-${parts.find(({ type }) => type === 'month').value}-${parts.find(({ type }) => type === 'day').value}`;
}

function schemaError(message, schemaStatus) {
  return new YahooCollectorError(message, {
    errorClass: 'schema_error', httpStatus: 200, schemaStatus, retryable: true
  });
}

function latestQuote(payload, symbol, currency, timezone, now) {
  const result = payload?.chart?.result?.[0];
  if (!result || typeof result !== 'object') {
    throw schemaError(`Yahoo chart payload is incomplete for ${symbol} (missing result)`, 'missing_result');
  }
  if (!Array.isArray(result.timestamp)) {
    throw schemaError(`Yahoo chart payload is incomplete for ${symbol} (missing timestamp or close series)`, 'missing_timestamp');
  }
  const quote = result?.indicators?.quote?.[0];
  if (!Array.isArray(quote?.close)) {
    throw schemaError(`Yahoo chart payload is incomplete for ${symbol} (missing timestamp or close series)`, 'missing_close');
  }
  if (quote.close.length !== result.timestamp.length) {
    throw schemaError(`Yahoo chart payload is inconsistent for ${symbol} (timestamp and close series differ)`, 'series_length_mismatch');
  }
  for (let index = quote.close.length - 1; index >= 0; index -= 1) {
    if (Number.isFinite(quote.close[index])) {
      if (localDate(new Date(result.timestamp[index] * 1_000), timezone) !== localDate(now, timezone)) {
        throw new YahooCollectorError(`Public quote is not from the current market date for ${symbol}`, {
          errorClass: 'data_delay', httpStatus: 200, schemaStatus: 'stale_market_date', retryable: true
        });
      }
      return Object.fromEntries([
        ['symbol', symbol], ['open', quote.open?.[index]], ['high', quote.high?.[index]], ['low', quote.low?.[index]],
        ['close', quote.close[index]], ['previousClose', result.meta?.regularMarketPreviousClose ?? result.meta?.previousClose],
        ['quoteAt', new Date(result.timestamp[index] * 1_000).toISOString()], ['currency', currency]
      ].filter(([, value]) => typeof value === 'string' || Number.isFinite(value)));
    }
  }
  throw schemaError(`No completed public quote for ${symbol}`, 'no_completed_close');
}

function httpError(symbol, status) {
  return new YahooCollectorError(`Public quote request failed for ${symbol} (HTTP ${status})`, {
    errorClass: 'http_error',
    httpStatus: status,
    retryable: status === 429 || status >= 500
  });
}

function classifyRequestError(error, symbol) {
  if (error instanceof YahooCollectorError) return error;
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return new YahooCollectorError(`Public quote request timed out for ${symbol}`, {
      errorClass: 'timeout', retryable: true, cause: error
    });
  }
  if (error instanceof TypeError) {
    return new YahooCollectorError(`Public quote network request failed for ${symbol}`, {
      errorClass: 'network_error', retryable: true, cause: error
    });
  }
  return new YahooCollectorError(`Public quote collection failed for ${symbol}`, {
    errorClass: 'collector_error', retryable: false, cause: error
  });
}

function calculateBackoffMilliseconds({ attempt, initialDelay, maximumDelay, jitterRatio, random }) {
  const exponentialDelay = Math.min(maximumDelay, initialDelay * (2 ** (attempt - 1)));
  const jitter = Math.round(exponentialDelay * jitterRatio * random());
  return exponentialDelay + jitter;
}

function normalizeDiagnosticContext(context = {}) {
  return Object.fromEntries([
    ['captureSlot', context.captureSlot],
    ['workflowRunId', context.workflowRunId],
    ['workflowRunAttempt', context.workflowRunAttempt],
    ['producerId', context.producerId]
  ].filter(([, value]) => typeof value === 'string' && value.trim()));
}

function describeYahooCollectorError(error) {
  const classified = error instanceof YahooCollectorError
    ? error
    : classifyRequestError(error, 'unknown');
  return {
    errorClass: classified.errorClass,
    httpStatus: classified.httpStatus,
    schemaStatus: classified.schemaStatus,
    retryable: classified.retryable
  };
}

function emitDiagnostic(onDiagnostic, diagnostic) {
  if (typeof onDiagnostic !== 'function') return;
  onDiagnostic(diagnostic);
}

async function requestYahooChart({ symbol, fetchImpl, timeoutMilliseconds, deadlineMilliseconds, currentTime }) {
  const remainingMilliseconds = deadlineMilliseconds === null
    ? timeoutMilliseconds
    : deadlineMilliseconds - currentTime();
  if (remainingMilliseconds <= 0) {
    throw new YahooCollectorError(`Capture timing budget was exhausted before requesting ${symbol}`, {
      errorClass: 'timing_budget_exhausted', retryable: false
    });
  }
  const response = await fetchImpl(`${ENDPOINT}${encodeURIComponent(symbol)}?range=1d&interval=1m`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMilliseconds, remainingMilliseconds)))
  });
  if (!response.ok) throw httpError(symbol, response.status);
  try {
    return await response.json();
  } catch (error) {
    throw new YahooCollectorError(`Public quote response was not valid JSON for ${symbol}`, {
      errorClass: 'invalid_json', httpStatus: response.status, schemaStatus: 'invalid_json', retryable: true, cause: error
    });
  }
}

async function fetchYahooChart(options) {
  const {
    symbol, currency, timezone, now, fetchImpl, maxAttempts, retryDelayMilliseconds,
    maxRetryDelayMilliseconds, retryJitterRatio, timeoutMilliseconds, random, sleepImpl,
    onDiagnostic, diagnosticContext, deadlineMilliseconds, currentTime
  } = options;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const payload = await requestYahooChart({
        symbol, fetchImpl, timeoutMilliseconds, deadlineMilliseconds, currentTime
      });
      return latestQuote(payload, symbol, currency, timezone, now);
    } catch (error) {
      lastError = classifyRequestError(error, symbol);
      const retryCandidate = lastError.retryable && attempt < maxAttempts;
      const candidateBackoff = retryCandidate
        ? calculateBackoffMilliseconds({
            attempt,
            initialDelay: retryDelayMilliseconds,
            maximumDelay: maxRetryDelayMilliseconds,
            jitterRatio: retryJitterRatio,
            random
          })
        : 0;
      const retryFitsDeadline = deadlineMilliseconds === null
        || currentTime() + candidateBackoff < deadlineMilliseconds;
      const willRetry = retryCandidate && retryFitsDeadline;
      const backoffMilliseconds = willRetry ? candidateBackoff : 0;
      emitDiagnostic(onDiagnostic, {
        provider: PROVIDER,
        endpointType: ENDPOINT_TYPE,
        symbol,
        attempt,
        maxAttempts,
        ...describeYahooCollectorError(lastError),
        backoffMilliseconds,
        finalAttempt: !willRetry,
        retrySuppressedReason: retryCandidate && !retryFitsDeadline ? 'capture_deadline' : '',
        ...normalizeDiagnosticContext(diagnosticContext)
      });
      if (!willRetry) break;
      if (backoffMilliseconds > 0) await sleepImpl(backoffMilliseconds);
    }
  }
  throw lastError || new YahooCollectorError(`Public quote request failed for ${symbol}`);
}

async function mapWithConcurrency(values, limit, task) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(values[index]);
    }
  };
  const workerResults = await Promise.allSettled(Array.from({ length: Math.min(limit, values.length) }, worker));
  const failure = workerResults.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
  return results;
}

export async function collectYahooCharts(symbols, {
  timezone,
  now = new Date(),
  fetchImpl = fetch,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryDelayMilliseconds = DEFAULT_RETRY_DELAY_MILLISECONDS,
  maxRetryDelayMilliseconds = DEFAULT_MAX_RETRY_DELAY_MILLISECONDS,
  retryJitterRatio = DEFAULT_RETRY_JITTER_RATIO,
  maxConcurrency = DEFAULT_MAX_CONCURRENCY,
  timeoutMilliseconds = DEFAULT_TIMEOUT_MILLISECONDS,
  random = Math.random,
  sleepImpl = sleep,
  onDiagnostic,
  diagnosticContext,
  deadlineAt,
  currentTime = Date.now
} = {}) {
  const normalizedAttempts = Math.max(1, Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS);
  const normalizedConcurrency = Math.max(1, Number(maxConcurrency) || DEFAULT_MAX_CONCURRENCY);
  const normalizedInitialDelay = Math.max(0, Number(retryDelayMilliseconds) || 0);
  const normalizedMaximumDelay = Math.max(normalizedInitialDelay, Number(maxRetryDelayMilliseconds) || DEFAULT_MAX_RETRY_DELAY_MILLISECONDS);
  const normalizedJitterRatio = Math.max(0, Number(retryJitterRatio) || 0);
  const normalizedTimeout = Math.max(1, Number(timeoutMilliseconds) || DEFAULT_TIMEOUT_MILLISECONDS);
  const parsedDeadline = deadlineAt instanceof Date ? deadlineAt.getTime() : Date.parse(String(deadlineAt || ''));
  const deadlineMilliseconds = Number.isFinite(parsedDeadline) ? parsedDeadline : null;
  const results = await mapWithConcurrency(symbols, normalizedConcurrency, async ({ symbol, currency }) => {
    try {
      return await fetchYahooChart({
        symbol, currency, timezone, now, fetchImpl,
        maxAttempts: normalizedAttempts,
        retryDelayMilliseconds: normalizedInitialDelay,
        maxRetryDelayMilliseconds: normalizedMaximumDelay,
        retryJitterRatio: normalizedJitterRatio,
        timeoutMilliseconds: normalizedTimeout,
        random,
        sleepImpl,
        onDiagnostic,
        diagnosticContext,
        deadlineMilliseconds,
        currentTime
      });
    } catch (error) {
      if (symbol.startsWith('^')) throw error;
      console.warn(`[yahoo-collector] Skipping symbol ${symbol} after ${normalizedAttempts} attempts: ${error.message}`);
      return null;
    }
  });
  return results.filter(Boolean);
}

export { describeYahooCollectorError };
