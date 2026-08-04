import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildTaipeiDecisionManifest } from '../src/cli/build-taipei-decision-manifest.js';

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value));
}

test('builds a Taipei 12:55 manifest without selecting future market data', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'decision-manifest-'));
  for (const market of ['tw', 'jp', 'kr', 'cn', 'sg', 'uk', 'eu', 'us']) {
    const region = ['uk', 'eu'].includes(market) ? 'europe' : market === 'us' ? 'america' : 'asia';
    const timezone = market === 'jp' ? 'Asia/Tokyo' : market === 'kr' ? 'Asia/Seoul' : market === 'cn' ? 'Asia/Shanghai' : market === 'us' ? 'America/New_York' : 'Asia/Taipei';
    await writeJson(path.join(root, 'config', 'markets', `${market}.json`), {
      market, region, timezone,
      sessions: { regular: market === 'cn' ? [{ open: '09:30', close: '11:30' }, { open: '13:00', close: '15:00' }] : [{ open: '09:00', close: '16:00' }] },
      calendar: { closedDates: [], specialSessions: {} }
    });
    const capturedAt = market === 'tw' ? '2026-07-30T04:55:30.000Z' : '2026-07-30T03:00:00.000Z';
    await writeJson(path.join(root, 'data', 'raw', region, market, '2026', '2026-07-30', 'regular', 'x.json'), {
      market, capturedAt, scheduledAt: market === 'tw' ? '2026-07-30T04:55:00.000Z' : '2026-07-30T03:00:00.000Z', captureDelaySeconds: market === 'tw' ? 30 : 0,
      timingStatus: 'on_time', quotes: [{ quoteAt: capturedAt }]
    });
    if (market === 'tw') {
      await writeJson(path.join(root, 'data', 'raw', region, market, '2026', '2026-07-30', 'regular', 'producers', 'decision-backup', '0455.json'), {
        market, capturedAt: '2026-07-30T04:55:40.000Z', scheduledAt: '2026-07-30T04:55:00.000Z', captureDelaySeconds: 40,
        timingStatus: 'on_time', producer: { id: 'decision-backup', role: 'backup' }, quotes: [{ quoteAt: '2026-07-30T04:55:30.000Z' }]
      });
    }
    await writeJson(path.join(root, 'data', 'raw', region, market, '2026', '2026-07-30', 'regular', 'future.json'), {
      market, capturedAt: '2026-07-30T05:20:00.000Z', scheduledAt: '2026-07-30T05:20:00.000Z', captureDelaySeconds: 0,
      timingStatus: 'on_time', quotes: [{ quoteAt: '2026-07-30T05:20:00.000Z' }]
    });
    if (market === 'cn') {
      await writeJson(path.join(root, 'data', 'raw', region, market, '2026', '2026-07-30', 'regular', 'after-decision.json'), {
        market, capturedAt: '2026-07-30T04:56:00.000Z', scheduledAt: '2026-07-30T04:56:00.000Z', captureDelaySeconds: 0,
        timingStatus: 'on_time', quotes: [{ quoteAt: '2026-07-30T04:56:00.000Z' }]
      });
    }
  }
  const { target, manifest } = await buildTaipeiDecisionManifest(root, { date: '2026-07-30', now: new Date('2026-07-30T05:10:00.000Z') });
  assert.equal(manifest.basis, 'taipei_1255_pre_order');
  assert.equal(manifest.markets.find((entry) => entry.market === 'tw').status, 'decision_window_capture');
  assert.match(manifest.markets.find((entry) => entry.market === 'tw').path, /regular\/x\.json$/);
  assert.ok(manifest.markets.every((entry) => !String(entry.capturedAt || '').startsWith('2026-07-30T05:20')));
  const china = manifest.markets.find((entry) => entry.market === 'cn');
  assert.equal(china.status, 'latest_available_before_decision');
  assert.equal(china.capturedAt, '2026-07-30T03:00:00.000Z');
  assert.equal(JSON.parse(await readFile(target, 'utf8')).date, '2026-07-30');
});
