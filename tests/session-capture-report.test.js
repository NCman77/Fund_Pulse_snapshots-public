import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSessionCaptureReport } from '../src/scheduling/session-capture-report.js';

const plan = {
  localDate: '2026-07-30',
  timezone: 'Asia/Taipei',
  slots: ['09:05', '12:55'],
  skippedSlots: []
};

test('marks a session healthy only when every expected slot is captured on time', () => {
  const report = buildSessionCaptureReport({
    market: 'tw', sessionName: 'full-day', plan,
    results: [
      { slot: '09:05', status: 'captured', timingStatus: 'on_time', attempts: 1 },
      { slot: '12:55', status: 'captured', timingStatus: 'on_time', attempts: 1 }
    ]
  });
  assert.equal(report.summary.complete, true);
  assert.equal(report.summary.healthy, true);
  assert.equal(report.summary.onTimeSlotCount, 2);
});

test('keeps late and failed slots in the report while marking the session unhealthy', () => {
  const report = buildSessionCaptureReport({
    market: 'tw', sessionName: 'full-day', plan,
    results: [
      { slot: '09:05', status: 'captured', timingStatus: 'late', attempts: 1 },
      { slot: '12:55', status: 'failed', attempts: 3, error: 'quote collection failed' }
    ]
  });
  assert.equal(report.summary.complete, false);
  assert.equal(report.summary.healthy, false);
  assert.equal(report.summary.lateSlotCount, 1);
  assert.equal(report.summary.failedSlotCount, 1);
});

test('records a missed late-start slot without treating it as a captured snapshot', () => {
  const report = buildSessionCaptureReport({
    market: 'tw', sessionName: 'full-day', plan,
    results: [
      { slot: '09:05', status: 'missed', timingStatus: 'missed', attempts: 0, captureDelaySeconds: 180 },
      { slot: '12:55', status: 'captured', timingStatus: 'on_time', attempts: 1 }
    ]
  });
  assert.equal(report.summary.capturedSlotCount, 1);
  assert.equal(report.summary.failedSlotCount, 1);
  assert.equal(report.summary.healthy, false);
});
