import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MARKET = /^[a-z]{2,8}$/;
const SESSION = /^(preopen|regular|close)$/;
const PRODUCER = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function snapshotPath(root, snapshot) {
  const slotTimestamp = typeof snapshot.scheduledAt === 'string' && !Number.isNaN(new Date(snapshot.scheduledAt).getTime())
    ? snapshot.scheduledAt
    : snapshot.capturedAt;
  const date = slotTimestamp.slice(0, 10);
  const time = slotTimestamp.slice(11, 16).replace(':', '');
  if (!ISO_DATE.test(date) || !MARKET.test(snapshot.market) || !SESSION.test(snapshot.session)) {
    throw new Error('Snapshot has an invalid market, session, or timestamp.');
  }
  const producerId = String(snapshot?.producer?.id || '').trim();
  if (producerId && !PRODUCER.test(producerId)) throw new Error('Snapshot producer ID is invalid.');
  const base = path.join(root, 'data', 'raw', snapshot.region, snapshot.market, date.slice(0, 4), date, snapshot.session);
  return producerId ? path.join(base, 'producers', producerId, `${time}.json`) : path.join(base, `${time}.json`);
}

export async function writeSnapshot(root, snapshot) {
  if (!snapshot.schemaVersion || !Array.isArray(snapshot.quotes)) {
    throw new Error('Snapshot must declare a schema version and quotes array.');
  }
  const target = snapshotPath(root, snapshot);
  try {
    const existing = JSON.parse(await readFile(target, 'utf8'));
    if (JSON.stringify(existing) === JSON.stringify(snapshot)) return target;
    throw new Error(`Immutable snapshot collision at ${target}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await writeJsonAtomically(target, snapshot);
  return target;
}

export async function writePartialCapture(root, snapshot) {
  if (!snapshot.schemaVersion || !Array.isArray(snapshot.quotes)) {
    throw new Error('Partial capture must declare a schema version and quotes array.');
  }
  const slotTimestamp = typeof snapshot.scheduledAt === 'string' && !Number.isNaN(new Date(snapshot.scheduledAt).getTime())
    ? snapshot.scheduledAt
    : snapshot.capturedAt;
  const date = slotTimestamp.slice(0, 10);
  const time = slotTimestamp.slice(11, 19).replace(/:/g, '');
  if (!ISO_DATE.test(date) || !MARKET.test(snapshot.market) || !SESSION.test(snapshot.session)) {
    throw new Error('Partial capture has an invalid market, session, or timestamp.');
  }
  const producerId = String(snapshot?.producer?.id || 'default').trim();
  if (!PRODUCER.test(producerId)) throw new Error('Partial capture producer ID is invalid.');
  const target = path.join(root, 'data', 'partial', snapshot.region, snapshot.market, date.slice(0, 4), date, snapshot.session, 'producers', producerId, `${time}-${randomUUID()}.json`);
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
