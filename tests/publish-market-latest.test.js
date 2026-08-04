import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeSnapshot } from '../src/storage/snapshot-writer.js';
import { publishMarketLatest, selectLatestSnapshot } from '../src/cli/publish-market-latest.js';

async function createRoot(t, { market = 'tw', region = 'asia', timezone = 'Asia/Taipei' } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'latest-publisher-'));
  t.after(async () => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  await mkdir(path.join(root, 'config', 'markets'), { recursive: true });
  await writeFile(path.join(root, 'config', 'markets', `${market}.json`), JSON.stringify({
    region,
    timezone
  }));
  return root;
}

test('selects the primary verified raw snapshot before an on-time backup for the same slot', async (t) => {
  const root = await createRoot(t, { market: 'uk', region: 'europe', timezone: 'Europe/London' });
  const [primaryPath, backupPath] = await Promise.all([
    writeSnapshot(root, {
      schemaVersion: '1.2', market: 'uk', region: 'europe', session: 'regular', quotes: [], timingStatus: 'on_time',
      scheduledAt: '2026-07-28T13:05:00.000Z', capturedAt: '2026-07-28T13:05:15.000Z', producer: { id: 's4', role: 'primary' }
    }),
    writeSnapshot(root, {
      schemaVersion: '1.2', market: 'uk', region: 'europe', session: 'regular', quotes: [], timingStatus: 'on_time',
      scheduledAt: '2026-07-28T13:05:00.000Z', capturedAt: '2026-07-28T13:05:10.000Z', producer: { id: 'uk-tail-handoff-backup', role: 'backup' }
    })
  ]);
  assert.notEqual(primaryPath, backupPath, 'primary and handoff must have isolated immutable paths');
  await writeSnapshot(root, {
    schemaVersion: '1.2', market: 'uk', region: 'europe', session: 'regular', quotes: [], timingStatus: 'late',
    scheduledAt: '2026-07-28T13:35:00.000Z', capturedAt: '2026-07-28T13:35:20.000Z', producer: { id: 's4', role: 'primary' }
  });
  const { candidate } = await selectLatestSnapshot(root, 'uk');
  assert.equal(candidate.snapshot.producer.id, 's4');
});

test('promotes an on-time backup with an auditable fallback reason', async (t) => {
  const root = await createRoot(t, { market: 'uk', region: 'europe', timezone: 'Europe/London' });
  await writeSnapshot(root, {
    schemaVersion: '1.2', market: 'uk', region: 'europe', session: 'regular', quotes: [], timingStatus: 'on_time',
    scheduledAt: '2026-07-28T13:05:00.000Z', capturedAt: '2026-07-28T13:05:10.000Z',
    producer: { id: 'uk-tail-handoff-backup', role: 'backup' }
  });

  const result = await publishMarketLatest(root, 'uk', {
    now: new Date('2026-07-28T13:05:20.000Z')
  });
  const latest = JSON.parse(await readFile(path.join(root, 'data', 'latest', 'uk.json'), 'utf8'));
  const health = JSON.parse(await readFile(path.join(root, 'data', 'status', 'markets', 'uk.json'), 'utf8'));

  assert.equal(result.status, 'published');
  assert.equal(latest.verification.producer.id, 'uk-tail-handoff-backup');
  assert.equal(latest.verification.producer.role, 'backup');
  assert.equal(latest.verification.fallbackReason, 'primary_missing_or_unverified_for_slot');
  assert.equal(health.fallbackReason, 'primary_missing_or_unverified_for_slot');
  assert.equal(latest.publishedAt, '2026-07-28T13:05:20.000Z');
});

test('keeps the last verified latest when no eligible raw snapshot exists', async (t) => {
  const root = await createRoot(t);
  const previousLatest = { market: 'tw', verification: { status: 'verified' }, capturedAt: '2026-07-27T05:00:00.000Z' };
  const previousHealth = { market: 'tw', status: 'healthy', capturedAt: '2026-07-27T05:00:00.000Z' };
  await mkdir(path.join(root, 'data', 'latest'), { recursive: true });
  await mkdir(path.join(root, 'data', 'status', 'markets'), { recursive: true });
  await writeFile(path.join(root, 'data', 'latest', 'tw.json'), JSON.stringify(previousLatest));
  await writeFile(path.join(root, 'data', 'status', 'markets', 'tw.json'), JSON.stringify(previousHealth));

  const result = await publishMarketLatest(root, 'tw', {
    now: new Date('2026-07-28T04:55:20.000Z')
  });

  assert.deepEqual(result, { market: 'tw', status: 'stale', reason: 'no_verified_raw_snapshot' });
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'data', 'latest', 'tw.json'), 'utf8')), previousLatest);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'data', 'status', 'markets', 'tw.json'), 'utf8')), {
    ...previousHealth,
    status: 'stale',
    reason: 'no_verified_raw_snapshot',
    updatedAt: '2026-07-28T04:55:20.000Z',
    sourcePath: '',
    producer: null,
    fallbackReason: 'no_verified_raw_snapshot',
    coverage: {
      status: 'legacy_unknown', complete: null, expectedSymbolCount: null, capturedSymbolCount: null, failedSymbols: []
    },
    latestQuoteAt: '',
    freshnessSeconds: 86120,
    freshnessEvaluatedAt: '2026-07-28T04:55:20.000Z',
    quoteFreshness: null,
    timezone: 'Asia/Taipei'
  });
});

test('does not replace latest with a complete snapshot containing a 20-minute-old quote', async (t) => {
  const root = await createRoot(t);
  await mkdir(path.join(root, 'config', 'policies'), { recursive: true });
  await writeFile(path.join(root, 'config', 'policies', 'provider-selection.json'), JSON.stringify({
    quoteFreshness: { regularMaxAgeSeconds: 300, maximumFutureSkewSeconds: 120 }
  }));
  await writeSnapshot(root, {
    schemaVersion: '1.2', market: 'tw', region: 'asia', session: 'regular', timingStatus: 'on_time',
    scheduledAt: '2026-08-04T01:05:00.000Z', capturedAt: '2026-08-04T01:05:10.000Z',
    quotes: [{ symbol: '2330.TW', quoteAt: '2026-08-04T00:45:00.000Z' }],
    coverage: { expectedSymbolCount: 1, capturedSymbolCount: 1, failedSymbols: [], complete: true }
  });
  const { candidate } = await selectLatestSnapshot(root, 'tw');
  assert.equal(candidate, null);
});

test('does not promote an on-time snapshot whose declared symbol coverage is partial', async (t) => {
  const root = await createRoot(t);
  await writeSnapshot(root, {
    schemaVersion: '1.2', market: 'tw', region: 'asia', session: 'regular', timingStatus: 'on_time',
    scheduledAt: '2026-07-28T04:55:00.000Z', capturedAt: '2026-07-28T04:55:10.000Z',
    quotes: [{ symbol: '2330.TW', quoteAt: '2026-07-28T04:55:00.000Z' }],
    coverage: {
      provider: 'yahoo-finance', endpointType: 'chart', expectedSymbolCount: 2,
      capturedSymbolCount: 1, failedSymbols: ['2454.TW'], complete: false
    }
  });
  const { candidate } = await selectLatestSnapshot(root, 'tw');
  assert.equal(candidate, null);
});
