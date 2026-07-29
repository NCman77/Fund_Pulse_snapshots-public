function expandCronField(value, minimum, maximum) {
  const values = new Set();
  for (const segment of String(value || '').split(',')) {
    const match = segment.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!match) return [];
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (start < minimum || end > maximum || start > end) return [];
    for (let number = start; number <= end; number += 1) values.add(number);
  }
  return [...values];
}

function resolveScheduledAt(scheduleRule, capturedAt = new Date()) {
  const [minuteField, hourField] = String(scheduleRule || '').trim().split(/\s+/, 3);
  const minutes = expandCronField(minuteField, 0, 59);
  const hours = expandCronField(hourField, 0, 23);
  if (!minutes.length || !hours.length) return null;

  const capturedMs = capturedAt.getTime();
  let latest = null;
  for (let dayOffset = 0; dayOffset >= -1; dayOffset -= 1) {
    for (const hour of hours) {
      for (const minute of minutes) {
        const candidate = new Date(Date.UTC(
          capturedAt.getUTCFullYear(), capturedAt.getUTCMonth(), capturedAt.getUTCDate() + dayOffset, hour, minute, 0, 0
        ));
        if (candidate.getTime() <= capturedMs && (!latest || candidate > latest)) latest = candidate;
      }
    }
  }
  return latest;
}

function buildCaptureTiming(scheduleRule, capturedAt = new Date(), maxDelaySeconds = 120, explicitScheduledAt = '') {
  const explicit = String(explicitScheduledAt || '').trim();
  const explicitDate = explicit ? new Date(explicit) : null;
  const scheduledAt = explicitDate && Number.isFinite(explicitDate.getTime())
    ? explicitDate
    : resolveScheduledAt(scheduleRule, capturedAt);
  if (!scheduledAt) {
    return { scheduledAt: null, captureDelaySeconds: null, timingStatus: 'manual_or_unknown' };
  }
  const captureDelaySeconds = Math.round((capturedAt.getTime() - scheduledAt.getTime()) / 1_000);
  return {
    scheduledAt: scheduledAt.toISOString(),
    captureDelaySeconds,
    timingStatus: captureDelaySeconds <= maxDelaySeconds ? 'on_time' : 'late'
  };
}

export { buildCaptureTiming, resolveScheduledAt };
