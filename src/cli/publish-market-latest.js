import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJsonAtomically } from '../storage/snapshot-writer.js';

const market = String(process.argv[2] || '').trim();
const root = process.cwd();

async function walkJson(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error));
  return (await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkJson(target);
    return entry.isFile() && entry.name.endsWith('.json') ? [target] : [];
  }))).flat();
}

function candidateRank(candidate) {
  return [candidate.scheduledMs, candidate.role === 'primary' ? 1 : 0, candidate.capturedMs];
}

function compareCandidates(left, right) {
  const leftRank = candidateRank(left);
  const rightRank = candidateRank(right);
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] !== rightRank[index]) return leftRank[index] - rightRank[index];
  }
  return left.filePath.localeCompare(right.filePath);
}

async function selectLatestSnapshot(rootDirectory, marketId) {
  const config = JSON.parse(await readFile(path.join(rootDirectory, 'config', 'markets', `${marketId}.json`), 'utf8'));
  const rawDirectory = path.join(rootDirectory, 'data', 'raw', config.region, marketId);
  const candidates = [];
  for (const filePath of await walkJson(rawDirectory)) {
    const content = await readFile(filePath, 'utf8');
    const snapshot = JSON.parse(content);
    const capturedMs = new Date(snapshot?.capturedAt || '').getTime();
    const scheduledMs = new Date(snapshot?.scheduledAt || snapshot?.capturedAt || '').getTime();
    if (snapshot?.market !== marketId || snapshot?.timingStatus !== 'on_time' || !Array.isArray(snapshot?.quotes)
      || !Number.isFinite(capturedMs) || !Number.isFinite(scheduledMs)) continue;
    candidates.push({ filePath, content, snapshot, capturedMs, scheduledMs, role: snapshot?.producer?.role === 'backup' ? 'backup' : 'primary' });
  }
  candidates.sort(compareCandidates);
  return { config, candidate: candidates.at(-1) || null };
}

async function main() {
  if (!/^[a-z]{2,8}$/.test(market)) throw new Error('Usage: node src/cli/publish-market-latest.js <market>');
  const { config, candidate } = await selectLatestSnapshot(root, market);
  if (!candidate) {
    console.log(JSON.stringify({ market, status: 'stale', reason: 'no_verified_raw_snapshot' }));
    return;
  }
  const sourcePath = path.relative(root, candidate.filePath).split(path.sep).join('/');
  const latest = {
    ...candidate.snapshot,
    publishedAt: new Date().toISOString(),
    verification: {
      status: 'verified', sourcePath, sourceSha256: createHash('sha256').update(candidate.content).digest('hex'),
      producer: candidate.snapshot.producer || { id: 'legacy', role: candidate.role },
      fallbackReason: candidate.role === 'backup' ? 'primary_missing_or_unverified_for_slot' : ''
    }
  };
  await writeJsonAtomically(path.join(root, 'data', 'latest', `${market}.json`), latest);
  await writeJsonAtomically(path.join(root, 'data', 'status', 'markets', `${market}.json`), {
    market, status: 'healthy', updatedAt: latest.publishedAt, sourcePath,
    capturedAt: latest.capturedAt, producer: latest.verification.producer, fallbackReason: latest.verification.fallbackReason,
    timezone: config.timezone
  });
  console.log(JSON.stringify({ market, status: 'published', sourcePath, producer: latest.verification.producer }));
}

const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isDirectRun) await main();

export { compareCandidates, main, selectLatestSnapshot };
