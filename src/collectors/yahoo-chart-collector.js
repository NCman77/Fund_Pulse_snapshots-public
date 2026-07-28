const ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart/';

function localDate(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date)
    .filter(({ type }) => type !== 'literal');
  return `${parts.find(({ type }) => type === 'year').value}-${parts.find(({ type }) => type === 'month').value}-${parts.find(({ type }) => type === 'day').value}`;
}

function latestQuote(payload, symbol, currency, timezone, now) {
  const result = payload?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!quote) throw new Error(`No public quote data for ${symbol}`);
  for (let index = quote.close.length - 1; index >= 0; index -= 1) {
    if (Number.isFinite(quote.close[index])) {
      if (localDate(new Date(result.timestamp[index] * 1_000), timezone) !== localDate(now, timezone)) {
        throw new Error(`Public quote is not from the current market date for ${symbol}`);
      }
      return Object.fromEntries([
        ['symbol', symbol], ['open', quote.open[index]], ['high', quote.high[index]], ['low', quote.low[index]],
        ['close', quote.close[index]], ['currency', currency]
      ].filter(([, value]) => typeof value === 'string' || Number.isFinite(value)));
    }
  }
  throw new Error(`No completed public quote for ${symbol}`);
}

export async function collectYahooCharts(symbols, { timezone, now = new Date(), fetchImpl = fetch }) {
  return Promise.all(symbols.map(async ({ symbol, currency }) => {
    const response = await fetchImpl(`${ENDPOINT}${encodeURIComponent(symbol)}?range=1d&interval=1m`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) throw new Error(`Public quote request failed for ${symbol}`);
    return latestQuote(await response.json(), symbol, currency, timezone, now);
  }));
}
