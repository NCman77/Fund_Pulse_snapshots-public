function normalizeCollection(collection) {
  if (!collection || typeof collection !== 'object') return null;
  return {
    provider: String(collection.provider || '').trim(),
    endpointType: String(collection.endpointType || '').trim(),
    expectedSymbolCount: Math.max(0, Number(collection.expectedSymbolCount || 0)),
    capturedSymbolCount: Math.max(0, Number(collection.capturedSymbolCount || 0)),
    failedSymbols: Array.isArray(collection.failedSymbols)
      ? collection.failedSymbols.map((symbol) => String(symbol || '').trim()).filter(Boolean)
      : []
  };
}

function normalizeDiagnostic(diagnostic = {}) {
  return Object.fromEntries([
    ['provider', String(diagnostic.provider || '').trim()],
    ['endpointType', String(diagnostic.endpointType || '').trim()],
    ['symbol', String(diagnostic.symbol || '').trim()],
    ['attempt', Math.max(0, Number(diagnostic.attempt || 0))],
    ['maxAttempts', Math.max(0, Number(diagnostic.maxAttempts || 0))],
    ['captureAttempt', Math.max(0, Number(diagnostic.captureAttempt || 0))],
    ['errorClass', String(diagnostic.errorClass || '').trim()],
    ['httpStatus', Number.isInteger(diagnostic.httpStatus) ? diagnostic.httpStatus : null],
    ['schemaStatus', String(diagnostic.schemaStatus || '').trim()],
    ['retryable', Boolean(diagnostic.retryable)],
    ['backoffMilliseconds', Math.max(0, Number(diagnostic.backoffMilliseconds || 0))],
    ['finalAttempt', Boolean(diagnostic.finalAttempt)],
    ['retrySuppressedReason', String(diagnostic.retrySuppressedReason || '').trim()],
    ['captureSlot', String(diagnostic.captureSlot || '').trim()],
    ['workflowRunId', String(diagnostic.workflowRunId || '').trim()],
    ['workflowRunAttempt', String(diagnostic.workflowRunAttempt || '').trim()],
    ['producerId', String(diagnostic.producerId || '').trim()]
  ].filter(([, value]) => value !== ''));
}

function normalizeSlotResult(result = {}) {
  const status = String(result.status || 'failed').trim();
  const timingStatus = String(result.timingStatus || '').trim();
  return {
    slot: String(result.slot || '').trim(),
    scheduledAt: String(result.scheduledAt || '').trim(),
    status,
    attempts: Number(result.attempts || 0),
    timingStatus,
    captureDelaySeconds: Number.isFinite(Number(result.captureDelaySeconds))
      ? Number(result.captureDelaySeconds)
      : null,
    providerFailure: String(result.providerFailure || '').trim(),
    error: String(result.error || '').trim(),
    collection: normalizeCollection(result.collection),
    diagnostics: (Array.isArray(result.diagnostics) ? result.diagnostics : []).map(normalizeDiagnostic)
  };
}

function isPartialSlot(result) {
  const collection = result.collection;
  return result.status === 'captured' && Boolean(collection)
    && (collection.failedSymbols.length > 0 || collection.capturedSymbolCount < collection.expectedSymbolCount);
}

function buildSessionCaptureReport({ market, sessionName, plan, results, generatedAt = new Date().toISOString() }) {
  const normalizedResults = (Array.isArray(results) ? results : []).map(normalizeSlotResult);
  const expectedSlots = Array.isArray(plan?.slots) ? plan.slots : [];
  const successfulSlots = normalizedResults.filter((result) => result.status === 'captured');
  const onTimeSlots = successfulSlots.filter((result) => result.timingStatus === 'on_time');
  const lateSlots = successfulSlots.filter((result) => result.timingStatus && result.timingStatus !== 'on_time');
  const failedSlots = normalizedResults.filter((result) => result.status !== 'captured');
  const partialSlots = successfulSlots.filter(isPartialSlot);
  const completeSlots = successfulSlots.filter((result) => !isPartialSlot(result));

  return {
    schemaVersion: '1.1',
    generatedAt,
    market: String(market || '').trim(),
    sessionName: String(sessionName || '').trim(),
    localDate: String(plan?.localDate || '').trim(),
    timezone: String(plan?.timezone || '').trim(),
    expectedSlots,
    skippedSlots: Array.isArray(plan?.skippedSlots) ? plan.skippedSlots : [],
    summary: {
      expectedSlotCount: expectedSlots.length,
      capturedSlotCount: successfulSlots.length,
      onTimeSlotCount: onTimeSlots.length,
      lateSlotCount: lateSlots.length,
      failedSlotCount: failedSlots.length,
      partialSlotCount: partialSlots.length,
      complete: completeSlots.length === expectedSlots.length,
      healthy: completeSlots.length === expectedSlots.length && onTimeSlots.length === expectedSlots.length
    },
    slots: normalizedResults
  };
}

export { buildSessionCaptureReport };
