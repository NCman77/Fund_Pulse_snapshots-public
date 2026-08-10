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

test('persists sanitized quote coverage and collector diagnostics for each slot', () => {
  const report = buildSessionCaptureReport({
    market: 'jp', sessionName: 'morning', plan: { ...plan, slots: ['09:05'] },
    results: [{
      slot: '09:05', status: 'captured', timingStatus: 'on_time', attempts: 1,
      collection: {
        provider: 'yahoo-finance', endpointType: 'chart',
        expectedSymbolCount: 2, capturedSymbolCount: 1, failedSymbols: ['MISSING.T']
      },
      diagnostics: [{
        provider: 'yahoo-finance', endpointType: 'chart', symbol: 'MISSING.T',
        attempt: 3, maxAttempts: 3, errorClass: 'schema_error', schemaStatus: 'missing_close',
        httpStatus: 200, retryable: true, backoffMilliseconds: 0,
        captureSlot: '09:05', workflowRunId: '123', workflowRunAttempt: '1', producerId: 'primary-morning',
        responseDiagnostic: {
          requestUrl: 'https://example.invalid/?token=must-not-persist', contentType: 'application/json',
          responsePreview: 'must-not-persist', httpStatus: 200, resultType: 'array', timestampType: 'undefined'
        }
      }]
    }]
  });

  assert.equal(report.schemaVersion, '1.1');
  assert.deepEqual(report.slots[0].collection.failedSymbols, ['MISSING.T']);
  assert.equal(report.slots[0].diagnostics[0].schemaStatus, 'missing_close');
  assert.equal(report.slots[0].collection.expectedSymbolCount, 2);
  assert.equal(report.slots[0].collection.requestedSymbolCount, 2);
  assert.equal('requestUrl' in report.slots[0].diagnostics[0].responseDiagnostic, false);
  assert.equal('contentType' in report.slots[0].diagnostics[0].responseDiagnostic, false);
  assert.equal('responsePreview' in report.slots[0].diagnostics[0].responseDiagnostic, false);
  assert.doesNotMatch(JSON.stringify(report), /must-not-persist/);
  assert.equal(report.summary.partialSlotCount, 1);
  assert.equal(report.summary.complete, false);
  assert.equal(report.summary.healthy, false);
});
