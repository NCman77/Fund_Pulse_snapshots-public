import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { publishMarketLatest } from '../src/cli/publish-market-latest.js';
import { captureSlotWithRetry } from '../src/cli/watch-market-session.js';
import { buildSessionCaptureReport } from '../src/scheduling/session-capture-report.js';
import { writeJsonAtomically, writeSnapshot } from '../src/storage/snapshot-writer.js';

test('promotes handoff raw after every primary capture attempt times out', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'session-fallback-'));
  t.after(async () => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await mkdir(path.join(root, 'config', 'markets'), { recursive: true });
  await writeFile(path.join(root, 'config', 'markets', 'uk.json'), JSON.stringify({
    region: 'europe',
    timezone: 'Europe/London'
  }));

  const target = {
    slot: '14:05',
    scheduledAt: new Date('2026-07-28T13:05:00.000Z')
  };
  let primaryAttempts = 0;
  const primaryResult = await captureSlotWithRetry({
    root,
    target,
    marketId: 'uk',
    maxAttempts: 3,
    retryDelayMs: 0,
    runCaptureFn: async () => {
      primaryAttempts += 1;
      const error = new Error(`primary request timeout ${primaryAttempts}`);
      error.captureResult = {
        collection: {
          provider: 'yahoo-finance', endpointType: 'chart',
          expectedSymbolCount: 2, capturedSymbolCount: 0, failedSymbols: ['^FTSE', 'GBPUSD=X']
        },
        diagnostics: [{
          provider: 'yahoo-finance', endpointType: 'chart', symbol: '^FTSE',
          attempt: 1, maxAttempts: 1, errorClass: 'timeout', retryable: true, finalAttempt: true,
          captureSlot: target.slot, producerId: 's4'
        }]
      };
      throw error;
    }
  });

  const backupResult = await captureSlotWithRetry({
    root,
    target,
    marketId: 'uk',
    maxAttempts: 3,
    retryDelayMs: 0,
    runCaptureFn: async () => {
      const snapshotPath = await writeSnapshot(root, {
        schemaVersion: '1.2', market: 'uk', region: 'europe', session: 'regular', quotes: [],
        timingStatus: 'on_time', scheduledAt: target.scheduledAt.toISOString(),
        capturedAt: '2026-07-28T13:05:08.000Z',
        producer: { id: 'uk-tail-handoff-backup', role: 'backup' }
      });
      return {
        status: 'captured',
        path: path.relative(root, snapshotPath),
        collection: {
          provider: 'yahoo-finance', endpointType: 'chart',
          expectedSymbolCount: 2, capturedSymbolCount: 2, failedSymbols: []
        },
        diagnostics: []
      };
    }
  });

  const plan = {
    localDate: '2026-07-28', timezone: 'Europe/London', slots: [target.slot], skippedSlots: []
  };
  const primaryReport = {
    ...buildSessionCaptureReport({ market: 'uk', sessionName: 's4', plan, results: [primaryResult] }),
    producer: { id: 's4', role: 'primary' }
  };
  const backupReport = {
    ...buildSessionCaptureReport({ market: 'uk', sessionName: 'uk-tail-handoff-backup', plan, results: [backupResult] }),
    producer: { id: 'uk-tail-handoff-backup', role: 'backup' }
  };
  await Promise.all([
    writeJsonAtomically(path.join(root, 'data', 'status', 'sessions', 'uk', '2026-07-28-s4.json'), primaryReport),
    writeJsonAtomically(path.join(root, 'data', 'status', 'sessions', 'uk', '2026-07-28-uk-tail-handoff-backup.json'), backupReport)
  ]);

  const publication = await publishMarketLatest(root, 'uk', {
    now: new Date('2026-07-28T13:05:20.000Z')
  });
  const latest = JSON.parse(await readFile(path.join(root, 'data', 'latest', 'uk.json'), 'utf8'));
  const producers = await readdir(path.join(
    root, 'data', 'raw', 'europe', 'uk', '2026', '2026-07-28', 'regular', 'producers'
  ));

  assert.equal(primaryAttempts, 3);
  assert.equal(primaryResult.status, 'failed');
  assert.deepEqual(primaryResult.diagnostics.map((item) => item.captureAttempt), [1, 2, 3]);
  assert.equal(primaryReport.summary.healthy, false);
  assert.equal(backupResult.status, 'captured');
  assert.equal(backupReport.summary.healthy, true);
  assert.deepEqual(producers, ['uk-tail-handoff-backup'], 'a failed primary must not create placeholder raw');
  assert.equal(publication.status, 'published');
  assert.equal(latest.verification.producer.id, 'uk-tail-handoff-backup');
  assert.equal(latest.verification.fallbackReason, 'primary_missing_or_unverified_for_slot');
});
