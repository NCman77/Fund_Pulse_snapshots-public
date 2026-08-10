function stringList(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function nonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : Math.max(0, Number(fallback) || 0);
}

function buildQuoteCollectionSummary(collection = {}, fallback = {}) {
  const source = { ...fallback, ...(collection && typeof collection === 'object' ? collection : {}) };
  const requestedSymbols = stringList(source.requestedSymbols);
  const capturedSymbols = stringList(source.capturedSymbols);
  const failedSymbols = stringList(source.failedSymbols);
  const notAttemptedSymbols = stringList(source.notAttemptedSymbols);
  const requiredSymbols = stringList(source.requiredSymbols);
  const optionalSymbols = stringList(source.optionalSymbols);
  const missingRequiredSymbols = stringList(source.missingRequiredSymbols);
  const requestedSymbolCount = nonNegativeNumber(
    source.requestedSymbolCount ?? source.expectedSymbolCount,
    requestedSymbols.length
  );
  const capturedSymbolCount = nonNegativeNumber(source.capturedSymbolCount, capturedSymbols.length);
  const failedSymbolCount = nonNegativeNumber(source.failedSymbolCount, failedSymbols.length);
  const notAttemptedSymbolCount = nonNegativeNumber(source.notAttemptedSymbolCount, notAttemptedSymbols.length);
  const attemptedSymbolCount = nonNegativeNumber(
    source.attemptedSymbolCount,
    capturedSymbolCount + failedSymbolCount
  );
  const complete = source.complete === undefined
    ? requestedSymbolCount > 0 && capturedSymbolCount === requestedSymbolCount
      && failedSymbolCount === 0 && notAttemptedSymbolCount === 0
    : Boolean(source.complete);
  const publishable = source.publishable === undefined
    ? complete && missingRequiredSymbols.length === 0
    : Boolean(source.publishable);

  return {
    provider: String(source.provider || '').trim(),
    endpointType: String(source.endpointType || '').trim(),
    // Preserve the established field while exposing the more precise name.
    // Older latest/status consumers still read expectedSymbolCount.
    expectedSymbolCount: requestedSymbolCount,
    requestedSymbolCount,
    attemptedSymbolCount,
    capturedSymbolCount,
    failedSymbolCount,
    notAttemptedSymbolCount,
    requestedSymbols,
    capturedSymbols,
    failedSymbols,
    notAttemptedSymbols,
    requiredSymbols,
    optionalSymbols,
    missingRequiredSymbols,
    collectionStatus: String(source.collectionStatus || (complete ? 'complete' : 'partial')).trim(),
    validationStatus: String(source.validationStatus || (complete ? 'valid' : 'incomplete_symbol_coverage')).trim(),
    publishable,
    complete
  };
}

export { buildQuoteCollectionSummary };
