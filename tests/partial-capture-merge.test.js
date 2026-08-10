import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildMergedCaptureCoverage, loadPartialCaptureSeeds, mergeQuotesBySymbol } from '../src/quality/partial-capture-merge.js';

const SCHEDULED_AT = '2026-08-10T13:05:00.000Z';

async function writeSeed(root, name, overrides = {}) {
  const relativePath = path.join('data', 'partial', 'north-america', 'us', `${name}.json`);
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify({
    market: 'us', scheduledAt: SCHEDULED_AT, publishable: false,
    producer: { id: 's1', role: 'primary' }, quotes: [], ...overrides
  }));
  return relativePath;
}

test('loads matching partial captures and keeps the newest quote for each expected symbol', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'partial-capture-merge-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const first = await writeSeed(root, 'first', { quotes: [
    { symbol: 'AAA', close: 1, quoteAt: '2026-08-10T13:04:00.000Z' }
  ] });
  const second = await writeSeed(root, 'second', { quotes: [
    { symbol: 'AAA', close: 2, quoteAt: '2026-08-10T13:04:30.000Z' },
    { symbol: 'BBB', close: 3, quoteAt: '2026-08-10T13:04:20.000Z' }
  ] });

  const quotes = await loadPartialCaptureSeeds({
    root, seedPaths: [first, second], market: 'us', scheduledAt: SCHEDULED_AT,
    producerId: 's1', expectedSymbols: ['AAA', 'BBB']
  });
  assert.deepEqual(quotes.map(({ symbol, close }) => ({ symbol, close })), [
    { symbol: 'AAA', close: 2 }, { symbol: 'BBB', close: 3 }
  ]);
});

test('rejects seed files outside data/partial or from a different slot', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'partial-capture-reject-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const wrongSlot = await writeSeed(root, 'wrong-slot', { scheduledAt: '2026-08-10T13:10:00.000Z' });
  const outside = path.join(root, 'outside.json');
  await writeFile(outside, '{}');

  await assert.rejects(() => loadPartialCaptureSeeds({
    root, seedPaths: [path.relative(root, outside)], market: 'us', scheduledAt: SCHEDULED_AT,
    producerId: 's1', expectedSymbols: ['AAA']
  }), /outside data\/partial/);
  await assert.rejects(() => loadPartialCaptureSeeds({
    root, seedPaths: [wrongSlot], market: 'us', scheduledAt: SCHEDULED_AT,
    producerId: 's1', expectedSymbols: ['AAA']
  }), /does not match/);
});

test('merging complementary attempts never invents an uncaptured symbol', () => {
  const quotes = mergeQuotesBySymbol(['AAA', 'BBB', 'CCC'],
    [{ symbol: 'AAA', close: 1 }],
    [{ symbol: 'BBB', close: 2 }, { symbol: 'UNEXPECTED', close: 9 }]);
  assert.deepEqual(quotes.map(({ symbol }) => symbol), ['AAA', 'BBB']);
});

test('keeps a merged capture non-publishable while any expected symbol is still missing', () => {
  const coverage = buildMergedCaptureCoverage({
    expectedSymbols: ['AAA', 'BBB', 'CCC'],
    capturedSymbols: ['AAA', 'BBB'],
    requiredSymbols: ['AAA', 'CCC'],
    optionalSymbols: ['BBB'],
    collection: { failedSymbols: ['CCC'], notAttemptedSymbols: [] },
    provider: 'yahoo-finance',
    endpointType: 'chart'
  });
  assert.equal(coverage.publishable, false);
  assert.equal(coverage.complete, false);
  assert.deepEqual(coverage.failedSymbols, ['CCC']);
  assert.deepEqual(coverage.missingRequiredSymbols, ['CCC']);
});
