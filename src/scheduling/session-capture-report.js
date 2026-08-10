import { buildQuoteCollectionSummary } from '../quality/quote-collection-summary.js';

function normalizeCollection(collection) {
  if (!collection || typeof collection !== 'object') return null;
  return buildQuoteCollectionSummary(collection);
}

function normalizeDiagnostic(diagnostic = {}) {
  const response = diagnostic.responseDiagnostic;
  const normalized = Object.fromEntries([
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
  if (response && typeof response === 'object') {
    normalized.responseDiagnostic = {
      httpStatus: Number.isInteger(response.httpStatus) ? response.httpStatus : null,
      chartError: response.chartError ?? null,
      resultType: String(response.resultType || '').trim(),
      resultKeys: Array.isArray(response.resultKeys) ? response.resultKeys.map((key) => String(key || '').trim()).filter(Boolean) : [],
      timestampType: String(response.timestampType || '').trim(),
      timestampLength: Number.isFinite(Number(response.timestampLength)) ? Number(response.timestampLength) : null,
      indicatorsQuoteType: String(response.indicatorsQuoteType || '').trim()
    };
  }
  return normalized;
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
  return Boolean(collection) && (collection.collectionStatus === 'partial' || !collection.publishable);
}

function buildSessionCaptureReport({ market, sessionName, plan, results, generatedAt = new Date().toISOString() }) {
  const normalizedResults = (Array.isArray(results) ? results : []).map(normalizeSlotResult);
  const expectedSlots = Array.isArray(plan?.slots) ? plan.slots : [];
  const successfulSlots = normalizedResults.filter((result) => result.status === 'captured');
  const onTimeSlots = successfulSlots.filter((result) => result.timingStatus === 'on_time');
  const lateSlots = successfulSlots.filter((result) => result.timingStatus && result.timingStatus !== 'on_time');
  const failedSlots = normalizedResults.filter((result) => result.status !== 'captured');
  const partialSlots = normalizedResults.filter(isPartialSlot);
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
