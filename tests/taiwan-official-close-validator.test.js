import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildTwseDatedUrl, officialDate, TPEX_URL, TWSE_URL, validateTaiwanOfficialClose } from '../src/official/taiwan-close-validator.js';

test('converts the official ROC compact date to Gregorian date', () => {
  assert.equal(officialDate('1150803'), '2026-08-03');
});

test('archives complete TWSE and TPEx official closes and compares the latest public reference', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taiwan-close-'));
  // Windows may still be releasing a file handle from the async fixture writes.
  // Retry the test-only cleanup so that it cannot mask a successful assertion.
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  await mkdir(path.join(root, 'config', 'public-symbols'), { recursive: true });
  await writeFile(path.join(root, 'config', 'public-symbols', 'approved-public-tickers.json'), JSON.stringify({
    markets: { tw: [{ symbol: '2330.TW' }, { symbol: '3081.TWO' }] }
  }));
  const raw = path.join(root, 'data', 'raw', 'asia', 'tw', '2026', '2026-08-03', 'close', '0530.json');
  await mkdir(path.dirname(raw), { recursive: true });
  await writeFile(raw, JSON.stringify({
    market: 'tw', scheduledAt: '2026-08-03T05:30:00.000Z', capturedAt: '2026-08-03T05:30:10.000Z',
    quotes: [
      { symbol: '2330.TW', close: 100, quoteAt: '2026-08-03T05:30:00.000Z' },
      { symbol: '3081.TWO', close: 200, quoteAt: '2026-08-03T05:30:00.000Z' }
    ]
  }));
  const fetchImpl = async (url) => ({
    ok: true, status: 200,
    json: async () => url === TWSE_URL
      ? [{ Date: '1150803', Code: '2330', Name: '台積電', ClosingPrice: '100', TradeVolume: '10' }]
      : url === TPEX_URL
        ? [{ Date: '1150803', SecuritiesCompanyCode: '3081', CompanyName: '聯亞', Close: '201', TradingShares: '20' }]
        : []
  });
  const result = await validateTaiwanOfficialClose({ root, date: '2026-08-03', fetchImpl, now: new Date('2026-08-03T08:00:00.000Z') });
  const stored = JSON.parse(await readFile(result.target, 'utf8'));
  assert.equal(result.status, 'verified');
  assert.equal(stored.officialCoverage.complete, true);
  assert.equal(stored.comparison.status, 'different');
  assert.equal(stored.symbols.find(({ symbol }) => symbol === '2330.TW').matchStatus, 'matched');
  assert.equal(stored.symbols.find(({ symbol }) => symbol === '3081.TWO').difference, -1);
});

test('falls back to the target-date TWSE report when the latest-only feed is stale', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taiwan-close-dated-fallback-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  await mkdir(path.join(root, 'config', 'public-symbols'), { recursive: true });
  await writeFile(path.join(root, 'config', 'public-symbols', 'approved-public-tickers.json'), JSON.stringify({
    markets: { tw: [{ symbol: '2330.TW' }, { symbol: '3081.TWO' }] }
  }));
  const fetchImpl = async (url) => ({
    ok: true, status: 200,
    json: async () => url === TWSE_URL
      ? [{ Date: '1150807', Code: '2330', Name: '台積電', ClosingPrice: '100', TradeVolume: '10' }]
      : url === TPEX_URL
        ? [{ Date: '1150810', SecuritiesCompanyCode: '3081', CompanyName: '聯亞', Close: '201', TradingShares: '20' }]
        : url === buildTwseDatedUrl('2026-08-10')
          ? {
              stat: 'OK', date: '20260810', tables: [{
                fields: ['證券代號', '證券名稱', '成交股數', '收盤價'],
                data: [['2330', '台積電', '10', '102']]
              }]
            }
          : null
  });

  const result = await validateTaiwanOfficialClose({ root, date: '2026-08-10', fetchImpl, now: new Date('2026-08-10T08:00:00.000Z') });
  assert.equal(result.status, 'verified');
  assert.equal(result.record.officialCoverage.complete, true);
  assert.equal(result.record.source.twse.url, buildTwseDatedUrl('2026-08-10'));
  assert.equal(result.record.symbols.find(({ symbol }) => symbol === '2330.TW').officialClose, 102);
});
