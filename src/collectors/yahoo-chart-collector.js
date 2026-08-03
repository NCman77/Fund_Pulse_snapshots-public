const ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MILLISECONDS = 750;
const DEFAULT_MAX_CONCURRENCY = 6;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function localDate(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date)
    .filter(({ type }) => type !== 'literal');
  return `${parts.find(({ type }) => type === 'year').value}-${parts.find(({ type }) => type === 'month').value}-${parts.find(({ type }) => type === 'day').value}`;
}

function latestQuote(payload, symbol, currency, timezone, now) {
  const result = payload?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!Array.isArray(result?.timestamp) || !Array.isArray(quote?.close)) {
    throw new Error(`Yahoo chart payload is incomplete for ${symbol} (missing timestamp or close series)`);
  }
  if (quote.close.length !== result.timestamp.length) {
    throw new Error(`Yahoo chart payload is inconsistent for ${symbol} (timestamp and close series differ)`);
  }
  for (let index = quote.close.length - 1; index >= 0; index -= 1) {
    if (Number.isFinite(quote.close[index])) {
      if (localDate(new Date(result.timestamp[index] * 1_000), timezone) !== localDate(now, timezone)) {
        throw new Error(`Public quote is not from the current market date for ${symbol}`);
      }
      return Object.fromEntries([
        ['symbol', symbol], ['open', quote.open?.[index]], ['high', quote.high?.[index]], ['low', quote.low?.[index]],
        ['close', quote.close[index]], ['previousClose', result.meta?.regularMarketPreviousClose ?? result.meta?.previousClose],
        ['quoteAt', new Date(result.timestamp[index] * 1_000).toISOString()], ['currency', currency]
      ].filter(([, value]) => typeof value === 'string' || Number.isFinite(value)));
    }
  }
  throw new Error(`No completed public quote for ${symbol}`);
}

async function fetchYahooChart({ symbol, currency, timezone, now, fetchImpl, maxAttempts, retryDelayMilliseconds }) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(`${ENDPOINT}${encodeURIComponent(symbol)}?range=1d&interval=1m`, {
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok) throw new Error(`Public quote request failed for ${symbol} (HTTP ${response.status})`);
      return latestQuote(await response.json(), symbol, currency, timezone, now);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await sleep(retryDelayMilliseconds * attempt);
    }
  }
  throw lastError || new Error(`Public quote request failed for ${symbol}`);
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
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

export async function collectYahooCharts(symbols, {
  timezone,
  now = new Date(),
  fetchImpl = fetch,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryDelayMilliseconds = DEFAULT_RETRY_DELAY_MILLISECONDS,
  maxConcurrency = DEFAULT_MAX_CONCURRENCY
} = {}) {
  const normalizedAttempts = Math.max(1, Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS);
  const normalizedConcurrency = Math.max(1, Number(maxConcurrency) || DEFAULT_MAX_CONCURRENCY);
  const results = await mapWithConcurrency(symbols, normalizedConcurrency, async ({ symbol, currency }) => {
    try {
      return await fetchYahooChart({
        symbol, currency, timezone, now, fetchImpl,
        maxAttempts: normalizedAttempts,
        retryDelayMilliseconds: Math.max(0, Number(retryDelayMilliseconds) || 0)
      });
    } catch (error) {
      if (symbol.startsWith('^')) throw error;
      console.warn(`[yahoo-collector] Skipping symbol ${symbol} after ${normalizedAttempts} attempts: ${error.message}`);
      return null;
    }
  });
  return results.filter(Boolean);
}
