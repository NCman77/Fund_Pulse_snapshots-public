import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeSnapshot } from '../src/storage/snapshot-writer.js';
import { selectLatestSnapshot } from '../src/cli/publish-market-latest.js';

test('selects the primary verified raw snapshot before an on-time backup for the same slot', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'latest-publisher-'));
  await writeSnapshot(root, {
    schemaVersion: '1.2', market: 'tw', region: 'asia', session: 'regular', quotes: [], timingStatus: 'on_time',
    scheduledAt: '2026-07-28T04:55:00.000Z', capturedAt: '2026-07-28T04:55:15.000Z', producer: { id: 'primary', role: 'primary' }
  });
  await writeSnapshot(root, {
    schemaVersion: '1.2', market: 'tw', region: 'asia', session: 'regular', quotes: [], timingStatus: 'on_time',
    scheduledAt: '2026-07-28T04:55:00.000Z', capturedAt: '2026-07-28T04:55:10.000Z', producer: { id: 'backup', role: 'backup' }
  });
  await writeSnapshot(root, {
    schemaVersion: '1.2', market: 'tw', region: 'asia', session: 'regular', quotes: [], timingStatus: 'late',
    scheduledAt: '2026-07-28T05:00:00.000Z', capturedAt: '2026-07-28T05:00:20.000Z', producer: { id: 'late', role: 'primary' }
  });
  await (await import('node:fs/promises')).mkdir(path.join(root, 'config', 'markets'), { recursive: true });
  await (await import('node:fs/promises')).writeFile(path.join(root, 'config', 'markets', 'tw.json'), JSON.stringify({ region: 'asia' }));

  const { candidate } = await selectLatestSnapshot(root, 'tw');
  assert.equal(candidate.snapshot.producer.id, 'primary');
});
