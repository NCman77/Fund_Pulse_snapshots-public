function timestamp(value) {
  const parsed = new Date(value || '').getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function sessionMaxAgeSeconds(session, policy = {}) {
  const key = `${String(session || '').toLowerCase()}MaxAgeSeconds`;
  const configured = policy[key];
  if (configured === null || configured === undefined || configured === '') return null;
  const parsed = Number(configured);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function assessQuoteFreshness(quotes = [], {
  referenceAt,
  maxAgeSeconds,
  maximumFutureSkewSeconds = 120
} = {}) {
  const referenceMs = timestamp(referenceAt);
  const maximumAge = maxAgeSeconds === null || maxAgeSeconds === undefined || maxAgeSeconds === ''
    ? Number.NaN
    : Number(maxAgeSeconds);
  const futureSkew = Math.max(0, Number(maximumFutureSkewSeconds) || 0);
  const unreliableQuoteAtSymbols = [];
  const staleSymbols = [];
  const futureSymbols = [];
  const ages = [];

  for (const quote of Array.isArray(quotes) ? quotes : []) {
    const symbol = String(quote?.symbol || '').trim();
    const quoteAtMs = timestamp(quote?.quoteAt);
    if (quoteAtMs === null || referenceMs === null) {
      unreliableQuoteAtSymbols.push(symbol);
      continue;
    }
    const ageSeconds = (referenceMs - quoteAtMs) / 1_000;
    ages.push(ageSeconds);
    if (Number.isFinite(maximumAge) && ageSeconds > maximumAge) staleSymbols.push(symbol);
    if (ageSeconds < -futureSkew) futureSymbols.push(symbol);
  }

  const enforced = Number.isFinite(maximumAge);
  return {
    status: unreliableQuoteAtSymbols.length || staleSymbols.length || futureSymbols.length ? 'rejected' : enforced ? 'fresh' : 'not_enforced',
    complete: unreliableQuoteAtSymbols.length === 0 && staleSymbols.length === 0 && futureSymbols.length === 0,
    enforced,
    referenceAt: referenceMs === null ? '' : new Date(referenceMs).toISOString(),
    maxAgeSeconds: enforced ? maximumAge : null,
    oldestQuoteAgeSeconds: ages.length ? Math.max(...ages) : null,
    newestQuoteAgeSeconds: ages.length ? Math.min(...ages) : null,
    unreliableQuoteAtSymbols,
    staleSymbols,
    futureSymbols
  };
}

function assessSnapshotQuoteFreshness(snapshot, policy = {}) {
  return assessQuoteFreshness(snapshot?.quotes, {
    referenceAt: snapshot?.scheduledAt || snapshot?.capturedAt,
    maxAgeSeconds: sessionMaxAgeSeconds(snapshot?.session, policy),
    maximumFutureSkewSeconds: policy.maximumFutureSkewSeconds
  });
}

export { assessQuoteFreshness, assessSnapshotQuoteFreshness, sessionMaxAgeSeconds };
