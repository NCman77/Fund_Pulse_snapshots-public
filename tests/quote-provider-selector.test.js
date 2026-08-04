import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuoteProvider } from '../src/providers/quote-provider.js';
import { assessQuoteCandidate, collectHedgedQuotes, selectQuoteCandidate } from '../src/selection/hedged-quote-selector.js';

const scheduledAt = '2026-08-04T01:05:00.000Z';
const deadlineAt = '2026-08-04T01:05:55.000Z';
const symbols = [{ symbol: '7203.T' }, { symbol: 'JPY=X' }];

function candidate(provider, capturedAt = '2026-08-04T01:05:20.000Z') {
  return {
    provider,
    capturedAt,
    quotes: symbols.map(({ symbol }) => ({ symbol, close: 100, quoteAt: '2026-08-04T01:05:10.000Z' }))
  };
}

test('provider contract rejects malformed collections', async () => {
  const provider = createQuoteProvider({ id: 'licensed-backup', endpointType: 'rest-api', collect: async () => ({ nope: [] }) });
  await assert.rejects(() => provider.collect(symbols), /invalid quote collection/);
});

test('selector prefers a complete primary and promotes a complete backup', () => {
  const primary = candidate({ id: 'primary' });
  const backup = candidate({ id: 'backup' });
  assert.equal(selectQuoteCandidate({ primary, backup, symbols, deadlineAt }).role, 'primary');

  primary.quotes = primary.quotes.slice(0, 1);
  const selected = selectQuoteCandidate({ primary, backup, symbols, deadlineAt });
  assert.equal(selected.role, 'backup');
  assert.equal(selected.fallbackReason, 'primary_failed_completeness_or_timing_validation');
});

test('selector rejects quotes without reliable quoteAt or beyond the hard deadline', () => {
  const missingQuoteAt = candidate({ id: 'primary' });
  delete missingQuoteAt.quotes[0].quoteAt;
  assert.deepEqual(assessQuoteCandidate(missingQuoteAt, { symbols, deadlineAt }).unreliableQuoteAtSymbols, ['7203.T']);

  const afterDeadline = candidate({ id: 'primary' }, '2026-08-04T01:05:56.000Z');
  afterDeadline.quotes[0].quoteAt = '2026-08-04T01:06:00.000Z';
  const assessment = assessQuoteCandidate(afterDeadline, { symbols, deadlineAt });
  assert.equal(assessment.eligible, false);
  assert.deepEqual(assessment.quoteAfterDeadlineSymbols, ['7203.T']);
  assert.equal(assessment.capturedAfterDeadline, true);
});

test('selector rejects a 20-minute-old quote at a 09:05 decision slot', () => {
  const stale = candidate({ id: 'primary' });
  stale.quotes[0].quoteAt = '2026-08-04T00:45:00.000Z';
  const assessment = assessQuoteCandidate(stale, { symbols, scheduledAt, deadlineAt, maxQuoteAgeSeconds: 300 });
  assert.equal(assessment.eligible, false);
  assert.deepEqual(assessment.staleQuoteSymbols, ['7203.T']);
});

test('hedged collection starts backup after the hedge delay and completes before the hard deadline', async () => {
  const starts = [];
  const primary = createQuoteProvider({
    id: 'slow-primary', endpointType: 'chart',
    collect: async () => new Promise(() => {})
  });
  const backup = createQuoteProvider({
    id: 'licensed-backup', endpointType: 'rest-api',
    collect: async () => {
      starts.push(Date.now());
      return candidate({ id: 'licensed-backup' }, '2026-08-04T01:05:20.000Z');
    }
  });
  const startedAt = Date.now();
  const result = await collectHedgedQuotes({
    primaryProvider: primary,
    backupProvider: backup,
    symbols,
    scheduledAt,
    hedgeDelayMilliseconds: 10,
    hardDeadlineSeconds: 55,
    now: () => new Date(scheduledAt).getTime() + (Date.now() - startedAt)
  });
  assert.equal(result.role, 'backup');
  assert.ok(starts[0] - startedAt >= 8);
});
