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
    error: String(result.error || '').trim()
  };
}

function buildSessionCaptureReport({ market, sessionName, plan, results, generatedAt = new Date().toISOString() }) {
  const normalizedResults = (Array.isArray(results) ? results : []).map(normalizeSlotResult);
  const expectedSlots = Array.isArray(plan?.slots) ? plan.slots : [];
  const successfulSlots = normalizedResults.filter((result) => result.status === 'captured');
  const onTimeSlots = successfulSlots.filter((result) => result.timingStatus === 'on_time');
  const lateSlots = successfulSlots.filter((result) => result.timingStatus && result.timingStatus !== 'on_time');
  const failedSlots = normalizedResults.filter((result) => result.status !== 'captured');

  return {
    schemaVersion: '1.0',
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
      complete: successfulSlots.length === expectedSlots.length,
      healthy: successfulSlots.length === expectedSlots.length && onTimeSlots.length === expectedSlots.length
    },
    slots: normalizedResults
  };
}

export { buildSessionCaptureReport };
