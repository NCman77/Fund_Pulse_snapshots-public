function normalizeProviderId(value, field) {
  const normalized = String(value || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(normalized)) {
    throw new Error(`Quote provider ${field} is invalid.`);
  }
  return normalized;
}

function createQuoteProvider({ id, endpointType, collect }) {
  const providerId = normalizeProviderId(id, 'id');
  const normalizedEndpointType = normalizeProviderId(endpointType, 'endpoint type');
  if (typeof collect !== 'function') throw new Error('Quote provider requires a collect function.');

  return Object.freeze({
    id: providerId,
    endpointType: normalizedEndpointType,
    async collect(symbols, context = {}) {
      const result = await collect(symbols, context);
      const quotes = Array.isArray(result) ? result : result?.quotes;
      if (!Array.isArray(quotes)) throw new Error(`Quote provider ${providerId} returned an invalid quote collection.`);
      return {
        ...(result && !Array.isArray(result) ? result : {}),
        quotes,
        capturedAt: String(result?.capturedAt || new Date().toISOString()),
        diagnostics: Array.isArray(result?.diagnostics) ? result.diagnostics : []
      };
    }
  });
}

export { createQuoteProvider };
