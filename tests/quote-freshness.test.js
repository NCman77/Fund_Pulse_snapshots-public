import assert from 'node:assert/strict';
import test from 'node:test';
import { assessQuoteFreshness, assessSnapshotQuoteFreshness } from '../src/quality/quote-freshness.js';

test('rejects a quote older than the configured regular-session maximum age', () => {
  const result = assessQuoteFreshness([
    { symbol: '2330.TW', quoteAt: '2026-08-04T01:04:30.000Z' },
    { symbol: '2454.TW', quoteAt: '2026-08-04T00:45:00.000Z' }
  ], { referenceAt: '2026-08-04T01:05:00.000Z', maxAgeSeconds: 300 });
  assert.equal(result.complete, false);
  assert.deepEqual(result.staleSymbols, ['2454.TW']);
  assert.equal(result.oldestQuoteAgeSeconds, 1200);
});

test('allows previous-close quote age during preopen but enforces it in regular trading', () => {
  const snapshot = {
    session: 'preopen', scheduledAt: '2026-08-04T00:55:00.000Z',
    quotes: [{ symbol: '2330.TW', quoteAt: '2026-08-03T05:30:00.000Z' }]
  };
  const policy = { preopenMaxAgeSeconds: null, regularMaxAgeSeconds: 300, maximumFutureSkewSeconds: 120 };
  assert.equal(assessSnapshotQuoteFreshness(snapshot, policy).status, 'not_enforced');
  assert.equal(assessSnapshotQuoteFreshness({ ...snapshot, session: 'regular' }, policy).status, 'rejected');
});
