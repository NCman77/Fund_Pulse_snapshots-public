import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MARKET = /^[a-z]{2,8}$/;
const SESSION = /^(preopen|regular|close)$/;

export function snapshotPath(root, snapshot) {
  const slotTimestamp = typeof snapshot.scheduledAt === 'string' && !Number.isNaN(new Date(snapshot.scheduledAt).getTime())
    ? snapshot.scheduledAt
    : snapshot.capturedAt;
  const date = slotTimestamp.slice(0, 10);
  const time = slotTimestamp.slice(11, 16).replace(':', '');
  if (!ISO_DATE.test(date) || !MARKET.test(snapshot.market) || !SESSION.test(snapshot.session)) {
    throw new Error('Snapshot has an invalid market, session, or timestamp.');
  }
  return path.join(root, 'data', 'raw', snapshot.region, snapshot.market, date.slice(0, 4), date, snapshot.session, `${time}.json`);
}

export async function writeSnapshot(root, snapshot) {
  if (!snapshot.schemaVersion || !Array.isArray(snapshot.quotes)) {
    throw new Error('Snapshot must declare a schema version and quotes array.');
  }
  const target = snapshotPath(root, snapshot);
  try {
    const existing = JSON.parse(await readFile(target, 'utf8'));
    if (existing?.timingStatus === 'on_time') return target;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await writeJsonAtomically(target, snapshot);
  return target;
}

export async function writeJsonAtomically(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  // A target may be written by an operator-triggered replay while a scheduled
  // watcher is finishing.  A per-write temp name keeps those atomic writes
  // independent; writeSnapshot still preserves an existing on-time snapshot.
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, target);
}
