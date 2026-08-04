import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildFundDecisionCoverage } from '../src/decision/fund-decision-coverage.js';

async function writeJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(value));
}

test('builds fund-level shadow eligibility from same-window holding and FX dependencies', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fund-decision-coverage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const relativePath = 'data/raw/asia/jp/2026/2026-08-04/regular/producers/decision-owner/0455.json';
  await writeJson(path.join(root, ...relativePath.split('/')), {
    market: 'jp',
    quotes: [
      { symbol: '7203.T', quoteAt: '2026-08-04T04:54:50.000Z' },
      { symbol: 'JPY=X', quoteAt: '2026-08-04T04:54:45.000Z' },
      { symbol: 'TWD=X', quoteAt: '2026-08-04T04:54:45.000Z' }
    ]
  });
  const holdingCoverage = {
    generatedAt: '2026-08-04T00:20:00.000Z', mappingVersion: 3,
    funds: [{
      fundId: 'FUND1', fundName: '測試基金', status: 'processed', capturedAt: '2026-08-04T00:19:00.000Z',
      holdingsDisclosureDate: '2026-07-31', mappedWeightPercent: 8,
      holdings: [{ name: 'Toyota', status: 'mapped', symbol: '7203.T', market: 'jp', currency: 'JPY', weightPercent: 8 }]
    }]
  };
  const result = await buildFundDecisionCoverage({
    root,
    decisionAt: '2026-08-04T04:55:00.000Z',
    decisionWindowEndsAt: '2026-08-04T04:55:55.000Z',
    marketEntries: [{ market: 'jp', marketStateAtDecision: 'regular', status: 'decision_window_capture', path: relativePath }],
    holdingCoverage,
    policy: { version: 1, mode: 'shadow_only', currencyQuoteSymbols: { JPY: ['JPY=X', 'TWD=X'] } }
  });
  assert.equal(result.mode, 'shadow_only');
  assert.equal(result.coverageAsOfDecision, true);
  assert.equal(result.eligibleFundCount, 1);
  assert.equal(result.funds[0].eligible, true);
  assert.equal(result.funds[0].dependencyCount, 3);
  assert.match(result.funds[0].dependencyFingerprint, /^[a-f0-9]{64}$/);
});

test('keeps a fund shadow-ineligible when a quote is after cutoff or a disclosed holding is unmapped', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fund-decision-missing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const relativePath = 'data/raw/asia/jp/2026/2026-08-04/regular/0455.json';
  await writeJson(path.join(root, ...relativePath.split('/')), {
    market: 'jp', quotes: [{ symbol: '7203.T', quoteAt: '2026-08-04T04:56:00.000Z' }]
  });
  const result = await buildFundDecisionCoverage({
    root,
    decisionAt: '2026-08-04T04:55:00.000Z',
    decisionWindowEndsAt: '2026-08-04T04:55:55.000Z',
    marketEntries: [{ market: 'jp', marketStateAtDecision: 'regular', status: 'decision_window_capture', path: relativePath }],
    holdingCoverage: {
      generatedAt: '2026-08-04T00:20:00.000Z', mappingVersion: 1,
      funds: [{
        fundId: 'FUND2', status: 'processed', capturedAt: '2026-08-04T00:19:00.000Z', mappedWeightPercent: 8,
        holdings: [
          { name: 'Toyota', status: 'mapped', symbol: '7203.T', market: 'jp', currency: 'JPY', weightPercent: 8 },
          { name: 'Unknown', status: 'unmapped', weightPercent: 2 }
        ]
      }]
    },
    policy: { version: 1, mode: 'shadow_only', currencyQuoteSymbols: { JPY: [] } }
  });
  assert.equal(result.funds[0].eligible, false);
  assert.deepEqual(result.funds[0].statusReasons, ['unmapped_disclosed_holdings', 'missing_qualified_dependencies']);
  assert.equal(result.funds[0].missingDependencies[0].symbol, '7203.T');
});
