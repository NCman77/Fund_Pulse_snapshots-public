import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCaptureTiming, resolveScheduledAt } from '../src/scheduling/scheduled-capture-timing.js';

test('resolves the latest matching UTC cron time and labels late captures', () => {
  const capturedAt = new Date('2026-07-29T04:57:10.000Z');
  assert.equal(resolveScheduledAt('55 4 * * 1-5', capturedAt)?.toISOString(), '2026-07-29T04:55:00.000Z');
  assert.deepEqual(buildCaptureTiming('55 4 * * 1-5', capturedAt), {
    scheduledAt: '2026-07-29T04:55:00.000Z', captureDelaySeconds: 130, timingStatus: 'late'
  });
});

test('handles lists and ranges used by the public snapshot workflow', () => {
  const capturedAt = new Date('2026-07-29T03:00:42.000Z');
  assert.deepEqual(buildCaptureTiming('0,30 2-5 * * 1-5', capturedAt), {
    scheduledAt: '2026-07-29T03:00:00.000Z', captureDelaySeconds: 42, timingStatus: 'on_time'
  });
  assert.deepEqual(buildCaptureTiming('', capturedAt), {
    scheduledAt: null, captureDelaySeconds: null, timingStatus: 'manual_or_unknown'
  });
});
