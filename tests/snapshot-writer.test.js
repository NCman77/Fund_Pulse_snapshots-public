import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writePartialCapture, writeSnapshot } from '../src/storage/snapshot-writer.js';

test('writes an isolated market snapshot below the public data root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'snapshots-'));
  const file = await writeSnapshot(root, {
    schemaVersion: '1.0', market: 'tw', region: 'asia', capturedAt: '2026-07-28T01:05:00.000Z',
    session: 'regular', source: 'approved-public-source', isDelayed: false, quotes: []
  });
  assert.match(file, /data[\\/]raw[\\/]asia[\\/]tw[\\/]2026[\\/]2026-07-28[\\/]regular[\\/]0105\.json$/);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).market, 'tw');
});

test('uses the scheduled capture slot and never replaces an immutable raw snapshot', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'snapshots-slot-'));
  const first = {
    schemaVersion: '1.2', market: 'tw', region: 'asia', capturedAt: '2026-07-28T04:55:08.000Z',
    scheduledAt: '2026-07-28T04:55:00.000Z', timingStatus: 'on_time',
    session: 'regular', source: 'approved-public-source', isDelayed: false, quotes: []
  };
  const duplicate = { ...first, capturedAt: '2026-07-28T04:55:59.000Z', timingStatus: 'late' };
  const target = await writeSnapshot(root, first);
  await assert.rejects(() => writeSnapshot(root, duplicate), /Immutable snapshot collision/);
  assert.match(target, /0455\.json$/);
  assert.equal(JSON.parse(await readFile(target, 'utf8')).timingStatus, 'on_time');
});

test('keeps backup raw output separate from the primary producer for the same slot', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'snapshots-producers-'));
  const base = {
    schemaVersion: '1.2', market: 'tw', region: 'asia', capturedAt: '2026-07-28T04:55:08.000Z',
    scheduledAt: '2026-07-28T04:55:00.000Z', timingStatus: 'on_time', session: 'regular', quotes: []
  };
  const primary = await writeSnapshot(root, { ...base, producer: { id: 'full-day', role: 'primary' } });
  const backup = await writeSnapshot(root, { ...base, producer: { id: 'preorder-backup', role: 'backup' } });
  assert.notEqual(primary, backup);
  assert.match(primary, /producers[\\/]full-day[\\/]0455\.json$/);
  assert.match(backup, /producers[\\/]preorder-backup[\\/]0455\.json$/);
});

test('stores partial attempts outside immutable raw paths and never collides retries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'snapshots-partial-'));
  const snapshot = {
    schemaVersion: '1.2', market: 'us', region: 'america', capturedAt: '2026-08-10T14:05:08.000Z',
    scheduledAt: '2026-08-10T14:05:00.000Z', timingStatus: 'on_time', session: 'regular',
    producer: { id: 's1', role: 'primary' }, publishable: false, quotes: [{ symbol: '^GSPC' }]
  };

  const first = await writePartialCapture(root, snapshot);
  const second = await writePartialCapture(root, snapshot);
  assert.notEqual(first, second);
  assert.match(first, /data[\\/]partial[\\/]america[\\/]us[\\/]2026[\\/]2026-08-10[\\/]regular[\\/]producers[\\/]s1[\\/]140500-[a-f0-9-]+\.json$/);
  assert.equal(JSON.parse(await readFile(first, 'utf8')).publishable, false);
});
