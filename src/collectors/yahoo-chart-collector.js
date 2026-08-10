const REQUEST_VARIANTS = [
  { endpoint: 'https://query1.finance.yahoo.com/v8/finance/chart/', range: '1d' },
  { endpoint: 'https://query2.finance.yahoo.com/v8/finance/chart/', range: '5d' },
  { endpoint: 'https://query1.finance.yahoo.com/v8/finance/chart/', range: '5d' }
];
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
    this.responseDiagnostic = details.responseDiagnostic || null;
  }
}

function sleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

function localDate(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date).filter(({ type }) => type !== 'literal');
  return `${parts.find(({ type }) => type === 'year').value}-${parts.find(({ type }) => type === 'month').value}-${parts.find(({ type }) => type === 'day').value}`;
}

function schemaError(message, schemaStatus, responseDiagnostic) {
  return new YahooCollectorError(message, {
    errorClass: 'schema_error', httpStatus: 200, schemaStatus, retryable: true, responseDiagnostic
  });
}

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function buildResponseDiagnostic({ response, payload }) {
  const result = payload?.chart?.result;
  const firstResult = Array.isArray(result) ? result[0] : undefined;
  const timestamp = firstResult?.timestamp;
  const quote = firstResult?.indicators?.quote;
  return {
    httpStatus: Number.isInteger(response?.status) ? response.status : null,
    chartError: payload?.chart?.error ?? null,
    resultType: typeOf(result),
    resultKeys: firstResult && typeof firstResult === 'object' && !Array.isArray(firstResult) ? Object.keys(firstResult) : [],
    timestampType: typeOf(timestamp),
    timestampLength: Array.isArray(timestamp) ? timestamp.length : null,
    indicatorsQuoteType: typeOf(quote)
  };
}

function latestQuote(payload, symbol, currency, timezone, now, responseDiagnostic) {
  if (payload?.chart?.error) {
    throw schemaError(`Yahoo chart returned an error for ${symbol}`, 'chart_error', responseDiagnostic);
  }
  const result = payload?.chart?.result?.[0];
  if (!result || typeof result !== 'object') {
    throw schemaError(`Yahoo chart payload is incomplete for ${symbol} (missing result)`, 'missing_result', responseDiagnostic);
  }
  if (!Array.isArray(result.timestamp)) {
    throw schemaError(`Yahoo chart payload is incomplete for ${symbol} (missing timestamp or close series)`, 'missing_timestamp', responseDiagnostic);
  }
  const quote = result?.indicators?.quote?.[0];
  if (!Array.isArray(quote?.close)) {
    throw schemaError(`Yahoo chart payload is incomplete for ${symbol} (missing timestamp or close series)`, 'missing_close', responseDiagnostic);
  }
  if (quote.close.length !== result.timestamp.length) {
    throw schemaError(`Yahoo chart payload is inconsistent for ${symbol} (timestamp and close series differ)`, 'series_length_mismatch', responseDiagnostic);
  }
  for (let index = quote.close.length - 1; index >= 0; index -= 1) {
    if (Number.isFinite(quote.close[index])) {
      if (localDate(new Date(result.timestamp[index] * 1_000), timezone) !== localDate(now, timezone)) {
        throw new YahooCollectorError(`Public quote is not from the current market date for ${symbol}`, {
          errorClass: 'data_delay', httpStatus: 200, schemaStatus: 'stale_market_date', retryable: true, responseDiagnostic
        });
      }
      return Object.fromEntries([
        ['symbol', symbol], ['open', quote.open?.[index]], ['high', quote.high?.[index]], ['low', quote.low?.[index]],
        ['close', quote.close[index]], ['previousClose', result.meta?.regularMarketPreviousClose ?? result.meta?.previousClose],
        ['quoteAt', new Date(result.timestamp[index] * 1_000).toISOString()], ['currency', currency]
      ].filter(([, value]) => typeof value === 'string' || Number.isFinite(value)));
    }
  }
  throw schemaError(`No completed public quote for ${symbol}`, 'no_completed_close', responseDiagnostic);
}

function httpError(symbol, status) {
  return new YahooCollectorError(`Public quote request failed for ${symbol} (HTTP ${status})`, {
    errorClass: 'http_error', httpStatus: status, retryable: status === 429 || status >= 500
  });
}

function classifyRequestError(error, symbol) {
  if (error instanceof YahooCollectorError) return error;
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return new YahooCollectorError(`Public quote request timed out for ${symbol}`, { errorClass: 'timeout', retryable: true, cause: error });
  if (error instanceof TypeError) return new YahooCollectorError(`Public quote network request failed for ${symbol}`, { errorClass: 'network_error', retryable: true, cause: error });
  return new YahooCollectorError(`Public quote collection failed for ${symbol}`, { errorClass: 'collector_error', retryable: false, cause: error });
}

function calculateBackoffMilliseconds({ attempt, initialDelay, maximumDelay, jitterRatio, random }) {
  const exponentialDelay = Math.min(maximumDelay, initialDelay * (2 ** (attempt - 1)));
  return exponentialDelay + Math.round(exponentialDelay * jitterRatio * random());
}

function normalizeDiagnosticContext(context = {}) {
  return Object.fromEntries([
    ['captureSlot', context.captureSlot], ['workflowRunId', context.workflowRunId],
    ['workflowRunAttempt', context.workflowRunAttempt], ['producerId', context.producerId]
  ].filter(([, value]) => typeof value === 'string' && value.trim()));
}

function describeYahooCollectorError(error) {
  const classified = error instanceof YahooCollectorError ? error : classifyRequestError(error, 'unknown');
  return {
    errorClass: classified.errorClass, httpStatus: classified.httpStatus, schemaStatus: classified.schemaStatus,
    retryable: classified.retryable, ...(classified.responseDiagnostic ? { responseDiagnostic: classified.responseDiagnostic } : {})
  };
}

function emitDiagnostic(onDiagnostic, diagnostic) { if (typeof onDiagnostic === 'function') onDiagnostic(diagnostic); }

async function readYahooPayload(response) {
  let responseBody = '';
  let payload;
  try {
    if (typeof response.text === 'function') {
      responseBody = await response.text();
      payload = JSON.parse(responseBody);
    } else {
      payload = await response.json();
      responseBody = JSON.stringify(payload);
    }
  } catch (error) {
    throw new YahooCollectorError('Public quote response was not valid JSON', {
      errorClass: 'invalid_json', httpStatus: response.status, schemaStatus: 'invalid_json', retryable: true, cause: error,
      responseDiagnostic: buildResponseDiagnostic({ response, payload: null })
    });
  }
  return { payload, responseDiagnostic: buildResponseDiagnostic({ response, payload }) };
}

async function requestYahooChart({ symbol, attempt, fetchImpl, timeoutMilliseconds, deadlineMilliseconds, currentTime, onRequestStart }) {
  const remainingMilliseconds = deadlineMilliseconds === null ? timeoutMilliseconds : deadlineMilliseconds - currentTime();
  if (remainingMilliseconds <= 0) throw new YahooCollectorError(`Capture timing budget was exhausted before requesting ${symbol}`, { errorClass: 'timing_budget_exhausted', retryable: false });
  const variant = REQUEST_VARIANTS[(Math.max(1, attempt) - 1) % REQUEST_VARIANTS.length];
  const requestUrl = `${variant.endpoint}${encodeURIComponent(symbol)}?range=${variant.range}&interval=1m`;
  if (typeof onRequestStart === 'function') onRequestStart();
  const response = await fetchImpl(requestUrl, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMilliseconds, remainingMilliseconds)))
  });
  if (!response.ok) throw httpError(symbol, response.status);
  return readYahooPayload(response);
}

async function fetchYahooChart(options) {
  const { symbol, currency, timezone, now, fetchImpl, maxAttempts, retryDelayMilliseconds, maxRetryDelayMilliseconds, retryJitterRatio, timeoutMilliseconds, random, sleepImpl, onDiagnostic, diagnosticContext, deadlineMilliseconds, currentTime, onRequestStart } = options;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { payload, responseDiagnostic } = await requestYahooChart({ symbol, attempt, fetchImpl, timeoutMilliseconds, deadlineMilliseconds, currentTime, onRequestStart });
      return latestQuote(payload, symbol, currency, timezone, now, responseDiagnostic);
    } catch (error) {
      lastError = classifyRequestError(error, symbol);
      const retryCandidate = lastError.retryable && attempt < maxAttempts;
      const candidateBackoff = retryCandidate ? calculateBackoffMilliseconds({ attempt, initialDelay: retryDelayMilliseconds, maximumDelay: maxRetryDelayMilliseconds, jitterRatio: retryJitterRatio, random }) : 0;
      const retryFitsDeadline = deadlineMilliseconds === null || currentTime() + candidateBackoff < deadlineMilliseconds;
      const willRetry = retryCandidate && retryFitsDeadline;
      emitDiagnostic(onDiagnostic, {
        provider: PROVIDER, endpointType: ENDPOINT_TYPE, symbol, attempt, maxAttempts,
        ...describeYahooCollectorError(lastError), backoffMilliseconds: willRetry ? candidateBackoff : 0,
        finalAttempt: !willRetry, retrySuppressedReason: retryCandidate && !retryFitsDeadline ? 'capture_deadline' : '',
        ...normalizeDiagnosticContext(diagnosticContext)
      });
      if (!willRetry) break;
      if (candidateBackoff > 0) await sleepImpl(candidateBackoff);
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
      results[index] = await task(values[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

function normalizedSymbolList(symbols) {
  return Array.from(new Map((Array.isArray(symbols) ? symbols : []).map((item) => [String(item?.symbol || '').trim(), item])).values())
    .filter(({ symbol }) => symbol);
}

function buildYahooCollectionResult({ symbols, outcomes, requiredSymbols = [], optionalSymbols = [] }) {
  const requestedSymbols = symbols.map(({ symbol }) => symbol);
  const required = new Set(requiredSymbols.map((symbol) => String(symbol || '').trim()).filter(Boolean));
  const capturedSymbols = outcomes.filter((outcome) => outcome?.status === 'captured').map((outcome) => outcome.symbol);
  const failedSymbols = outcomes.filter((outcome) => outcome?.status === 'failed').map((outcome) => outcome.symbol);
  const notAttemptedSymbols = requestedSymbols.filter((symbol, index) => outcomes[index]?.status === 'not_attempted');
  const missingRequiredSymbols = requestedSymbols.filter((symbol) => required.has(symbol) && !capturedSymbols.includes(symbol));
  const complete = capturedSymbols.length === requestedSymbols.length;
  const validationStatus = notAttemptedSymbols.length
    ? 'collection_interrupted'
    : missingRequiredSymbols.length
      ? 'missing_required_symbols'
      : complete ? 'valid' : 'incomplete_symbol_coverage';
  return {
    provider: PROVIDER, endpointType: ENDPOINT_TYPE,
    expectedSymbolCount: requestedSymbols.length,
    requestedSymbolCount: requestedSymbols.length,
    attemptedSymbolCount: capturedSymbols.length + failedSymbols.length,
    capturedSymbolCount: capturedSymbols.length,
    failedSymbolCount: failedSymbols.length,
    notAttemptedSymbolCount: notAttemptedSymbols.length,
    requestedSymbols, capturedSymbols, failedSymbols, notAttemptedSymbols,
    requiredSymbols: [...required], optionalSymbols: optionalSymbols.map((symbol) => String(symbol || '').trim()).filter(Boolean), missingRequiredSymbols,
    collectionStatus: complete ? 'complete' : 'partial',
    validationStatus,
    publishable: complete && missingRequiredSymbols.length === 0,
    complete
  };
}

export async function collectYahooChartCollection(symbols, options = {}) {
  const normalizedSymbols = normalizedSymbolList(symbols);
  const normalizedAttempts = Math.max(1, Number(options.maxAttempts) || DEFAULT_MAX_ATTEMPTS);
  const normalizedConcurrency = Math.max(1, Number(options.maxConcurrency) || DEFAULT_MAX_CONCURRENCY);
  const normalizedInitialDelay = Math.max(0, Number(options.retryDelayMilliseconds ?? DEFAULT_RETRY_DELAY_MILLISECONDS) || 0);
  const normalizedMaximumDelay = Math.max(normalizedInitialDelay, Number(options.maxRetryDelayMilliseconds) || DEFAULT_MAX_RETRY_DELAY_MILLISECONDS);
  const normalizedJitterRatio = Math.max(0, Number(options.retryJitterRatio ?? DEFAULT_RETRY_JITTER_RATIO) || 0);
  const normalizedTimeout = Math.max(1, Number(options.timeoutMilliseconds) || DEFAULT_TIMEOUT_MILLISECONDS);
  const parsedDeadline = options.deadlineAt instanceof Date ? options.deadlineAt.getTime() : Date.parse(String(options.deadlineAt || ''));
  const deadlineMilliseconds = Number.isFinite(parsedDeadline) ? parsedDeadline : null;
  const outcomes = normalizedSymbols.map(({ symbol }) => ({ symbol, status: 'not_attempted' }));

  try {
    await mapWithConcurrency(normalizedSymbols, normalizedConcurrency, async ({ symbol, currency }, index) => {
      try {
        const quote = await fetchYahooChart({
          symbol, currency, timezone: options.timezone, now: options.now || new Date(), fetchImpl: options.fetchImpl || fetch,
          maxAttempts: normalizedAttempts, retryDelayMilliseconds: normalizedInitialDelay,
          maxRetryDelayMilliseconds: normalizedMaximumDelay, retryJitterRatio: normalizedJitterRatio,
          timeoutMilliseconds: normalizedTimeout, random: options.random || Math.random, sleepImpl: options.sleepImpl || sleep,
          onDiagnostic: options.onDiagnostic, diagnosticContext: options.diagnosticContext,
          deadlineMilliseconds, currentTime: options.currentTime || Date.now,
          onRequestStart: () => { outcomes[index] = { symbol, status: 'attempted' }; }
        });
        outcomes[index] = { symbol, status: 'captured', quote };
      } catch (error) {
        const failure = describeYahooCollectorError(error);
        outcomes[index] = outcomes[index].status === 'not_attempted'
          ? { symbol, status: 'not_attempted', failure }
          : { symbol, status: 'failed', failure };
      }
      return outcomes[index];
    });
  } catch (error) {
    // The pre-filled entries make any symbols skipped by an unexpected orchestration fault explicit.
  }

  const collection = buildYahooCollectionResult({
    symbols: normalizedSymbols, outcomes,
    requiredSymbols: options.requiredSymbols || normalizedSymbols.map(({ symbol }) => symbol),
    optionalSymbols: options.optionalSymbols || []
  });
  return { ...collection, quotes: outcomes.filter((outcome) => outcome.status === 'captured').map((outcome) => outcome.quote), outcomes };
}

export async function collectYahooCharts(symbols, options = {}) {
  const collection = await collectYahooChartCollection(symbols, options);
  return collection.quotes;
}

export { buildResponseDiagnostic, buildYahooCollectionResult, describeYahooCollectorError };
