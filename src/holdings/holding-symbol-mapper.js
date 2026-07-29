function normalizeHoldingName(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[（）()\-－_,.*/\s]/g, '')
    // Disclosure sources often append a country suffix (for example, "-USA").
    // It identifies the listing venue, not a different issuer, so normalise it
    // before looking up the explicitly reviewed mapping.
    .replace(/(USA|JPN|KOR|DEU)$/g, '');
}

function buildHoldingSymbolIndex(mappings = []) {
  const index = new Map();
  for (const mapping of mappings) {
    const key = normalizeHoldingName(mapping?.name);
    if (!key || !mapping?.symbol || !mapping?.market || !mapping?.currency) continue;
    if (index.has(key)) throw new Error(`Duplicate approved public holding mapping: ${mapping.name}`);
    index.set(key, {
      symbol: mapping.symbol,
      market: mapping.market,
      currency: mapping.currency
    });
  }
  return index;
}

function resolveHoldingSymbol(name, index) {
  return index.get(normalizeHoldingName(name)) || null;
}

export { buildHoldingSymbolIndex, normalizeHoldingName, resolveHoldingSymbol };
