import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeSnapshot } from '../src/storage/snapshot-writer.js';

test('writes an isolated market snapshot below the public data root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'snapshots-'));
  const file = await writeSnapshot(root, {
    schemaVersion: '1.0', market: 'tw', region: 'asia', capturedAt: '2026-07-28T01:05:00.000Z',
    session: 'regular', source: 'approved-public-source', isDelayed: false, quotes: []
  });
  assert.match(file, /data[\\/]raw[\\/]asia[\\/]tw[\\/]2026[\\/]2026-07-28[\\/]regular[\\/]0105\.json$/);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).market, 'tw');
});

test('uses the scheduled capture slot and never replaces an on-time raw snapshot', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'snapshots-slot-'));
  const first = {
    schemaVersion: '1.2', market: 'tw', region: 'asia', capturedAt: '2026-07-28T04:55:08.000Z',
    scheduledAt: '2026-07-28T04:55:00.000Z', timingStatus: 'on_time',
    session: 'regular', source: 'approved-public-source', isDelayed: false, quotes: []
  };
  const duplicate = { ...first, capturedAt: '2026-07-28T04:55:59.000Z', timingStatus: 'late' };
  const target = await writeSnapshot(root, first);
  await writeSnapshot(root, duplicate);
  assert.match(target, /0455\.json$/);
  assert.equal(JSON.parse(await readFile(target, 'utf8')).timingStatus, 'on_time');
});
