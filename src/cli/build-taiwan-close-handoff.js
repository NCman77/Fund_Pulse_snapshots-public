import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJsonAtomically } from '../storage/snapshot-writer.js';

const __filename = fileURLToPath(import.meta.url);
const root = process.cwd();
const TAIPEI_TIMEZONE = 'Asia/Taipei';

function taipeiDate(value = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(value).filter(({ type }) => type !== 'literal').map(({ type, value: part }) => [type, part]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function buildTaiwanCloseHandoff({
  rootDir = root,
  date = String(process.env.TAIWAN_CLOSE_HANDOFF_DATE || taipeiDate()).trim()
} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Taiwan close handoff date must be YYYY-MM-DD.');
  const rawPath = path.join(rootDir, 'data', 'raw', 'asia', 'tw', date.slice(0, 4), date, 'regular', 'producers', 's3', '0530.json');
  let rawText;
  try {
    rawText = await readFile(rawPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'not_available', date, reason: 'taiwan_1330_raw_snapshot_missing' };
    throw error;
  }
  const raw = JSON.parse(rawText);
  const expectedSlot = `${date}T05:30:00.000Z`;
  if (raw?.market !== 'tw' || raw?.region !== 'asia' || raw?.session !== 'regular'
    || raw?.scheduledAt !== expectedSlot || raw?.timingStatus !== 'on_time'
    || raw?.publishable !== true || raw?.coverage?.complete !== true) {
    throw new Error('Taiwan 13:30 raw snapshot did not satisfy the verified-close handoff requirements.');
  }
  const handoff = {
    schemaVersion: '1.0',
    type: 'taiwan_verified_close_handoff',
    market: 'tw',
    date,
    scheduleSlot: '13:30',
    generatedAt: new Date().toISOString(),
    snapshot: {
      path: path.relative(rootDir, rawPath).split(path.sep).join('/'),
      sha256: sha256(rawText),
      capturedAt: raw.capturedAt,
      scheduledAt: raw.scheduledAt,
      timingStatus: raw.timingStatus,
      captureDelaySeconds: raw.captureDelaySeconds,
      coverage: raw.coverage
    }
  };
  const target = path.join(rootDir, 'data', 'handoffs', 'taiwan-close', date.slice(0, 4), `${date}.json`);
  await writeJsonAtomically(target, handoff);
  return { status: 'published', date, path: target, handoff };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  buildTaiwanCloseHandoff().then((result) => console.log(JSON.stringify({ ...result, path: result.path ? path.relative(root, result.path) : '' }))).catch((error) => {
    console.error(`[taiwan-close-handoff] ${error.message}`);
    process.exitCode = 1;
  });
}

export { buildTaiwanCloseHandoff, taipeiDate };
