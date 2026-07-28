import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildDailyManifest } from '../src/storage/manifest-builder.js';
import { writeSnapshot } from '../src/storage/snapshot-writer.js';

test('builds a checksum manifest from raw snapshots only', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'manifest-'));
  await writeSnapshot(root, {
    schemaVersion: '1.0', market: 'tw', region: 'asia', capturedAt: '2026-07-28T01:05:00.000Z',
    session: 'regular', source: 'public-source', isDelayed: true, quotes: []
  });
  const manifestPath = await buildDailyManifest(root, { market: 'tw', region: 'asia', date: '2026-07-28' });
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.snapshots.length, 1);
  assert.match(manifest.snapshots[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(await buildDailyManifest(root, { market: 'tw', region: 'asia', date: '2026-07-28' }), null);
});
