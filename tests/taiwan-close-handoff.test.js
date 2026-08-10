import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildTaiwanCloseHandoff } from '../src/cli/build-taiwan-close-handoff.js';

test('publishes a hash-verified Taiwan 13:30 close handoff only for a complete on-time snapshot', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tw-close-handoff-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const rawPath = path.join(root, 'data', 'raw', 'asia', 'tw', '2026', '2026-08-10', 'regular', 'producers', 's3', '0530.json');
  await mkdir(path.dirname(rawPath), { recursive: true });
  await writeFile(rawPath, JSON.stringify({
    schemaVersion: '1.2', market: 'tw', region: 'asia', session: 'regular',
    scheduledAt: '2026-08-10T05:30:00.000Z', capturedAt: '2026-08-10T05:30:01.000Z',
    timingStatus: 'on_time', captureDelaySeconds: 1, publishable: true,
    coverage: { complete: true, expectedSymbolCount: 2, capturedSymbolCount: 2 }, quotes: []
  }));

  const result = await buildTaiwanCloseHandoff({ rootDir: root, date: '2026-08-10' });
  const handoff = JSON.parse(await readFile(result.path, 'utf8'));

  assert.equal(result.status, 'published');
  assert.equal(handoff.type, 'taiwan_verified_close_handoff');
  assert.equal(handoff.scheduleSlot, '13:30');
  assert.equal(handoff.snapshot.path, 'data/raw/asia/tw/2026/2026-08-10/regular/producers/s3/0530.json');
  assert.match(handoff.snapshot.sha256, /^[a-f0-9]{64}$/);
});
