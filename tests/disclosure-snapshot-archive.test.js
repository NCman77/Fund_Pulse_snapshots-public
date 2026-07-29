import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDisclosureSnapshot } from '../src/funds/disclosure-snapshot-archive.js';

test('archives a dated public disclosure with only reviewed public holding symbols', () => {
  const archive = buildDisclosureSnapshot({
    fundId: 'ACDD04', fundName: '測試基金', capturedAt: '2026-07-29T10:35:00.000Z', source: { name: 'moneydj-public' },
    nav: { date: '2026-07-28', value: 100 }, holdingsDisclosure: { date: '2026-06-30', holdings: [{ name: '台積電', weightPercent: 10 }] }
  }, new Map([['台積電', { symbol: '2330.TW', market: 'tw', currency: 'TWD' }]]));
  assert.equal(archive.capturedAt, '2026-07-29T10:35:00.000Z');
  assert.deepEqual(archive.approvedHoldingSymbols, [{ name: '台積電', symbol: '2330.TW', market: 'tw', currency: 'TWD' }]);
});
