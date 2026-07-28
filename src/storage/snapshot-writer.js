import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MARKET = /^[a-z]{2,8}$/;
const SESSION = /^(preopen|regular|close)$/;

export function snapshotPath(root, snapshot) {
  const date = snapshot.capturedAt.slice(0, 10);
  const time = snapshot.capturedAt.slice(11, 16).replace(':', '');
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
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  await rename(temporary, target);
  return target;
}

