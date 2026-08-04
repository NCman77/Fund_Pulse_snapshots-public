import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJsonAtomically } from '../storage/snapshot-writer.js';
import { assessSnapshotQuoteFreshness } from '../quality/quote-freshness.js';

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

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
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
  const providerPolicy = await readJson(path.join(rootDirectory, 'config', 'policies', 'provider-selection.json'), {});
  const rawDirectory = path.join(rootDirectory, 'data', 'raw', config.region, marketId);
  const candidates = [];
  for (const filePath of await walkJson(rawDirectory)) {
    const content = await readFile(filePath, 'utf8');
    const snapshot = JSON.parse(content);
    const capturedMs = new Date(snapshot?.capturedAt || '').getTime();
    const scheduledMs = new Date(snapshot?.scheduledAt || snapshot?.capturedAt || '').getTime();
    const coverageComplete = snapshot?.coverage === undefined || snapshot?.coverage?.complete === true;
    const quoteFreshness = assessSnapshotQuoteFreshness(snapshot, providerPolicy.quoteFreshness || {});
    if (snapshot?.market !== marketId || snapshot?.timingStatus !== 'on_time' || !Array.isArray(snapshot?.quotes) || !coverageComplete
      || !quoteFreshness.complete || !Number.isFinite(capturedMs) || !Number.isFinite(scheduledMs)) continue;
    candidates.push({ filePath, content, snapshot, quoteFreshness, capturedMs, scheduledMs, role: snapshot?.producer?.role === 'backup' ? 'backup' : 'primary' });
  }
  candidates.sort(compareCandidates);
  return { config, candidate: candidates.at(-1) || null };
}

function describeCoverage(snapshot) {
  if (!snapshot?.coverage || typeof snapshot.coverage !== 'object') {
    return { status: 'legacy_unknown', complete: null, expectedSymbolCount: null, capturedSymbolCount: null, failedSymbols: [] };
  }
  return {
    status: snapshot.coverage.complete === true ? 'complete' : 'partial',
    complete: snapshot.coverage.complete === true,
    expectedSymbolCount: Number(snapshot.coverage.expectedSymbolCount || 0),
    capturedSymbolCount: Number(snapshot.coverage.capturedSymbolCount || 0),
    failedSymbols: Array.isArray(snapshot.coverage.failedSymbols) ? snapshot.coverage.failedSymbols : []
  };
}

function latestQuoteAt(snapshot) {
  return (snapshot?.quotes || [])
    .map((quote) => String(quote?.quoteAt || ''))
    .filter((value) => Number.isFinite(new Date(value).getTime()))
    .sort()
    .at(-1) || '';
}

function freshnessSeconds(capturedAt, now) {
  const capturedMs = new Date(capturedAt || '').getTime();
  const nowMs = new Date(now).getTime();
  return Number.isFinite(capturedMs) && Number.isFinite(nowMs)
    ? Math.max(0, Math.round((nowMs - capturedMs) / 1_000))
    : null;
}

async function publishMarketLatest(rootDirectory, marketId, { now = new Date() } = {}) {
  const { config, candidate } = await selectLatestSnapshot(rootDirectory, marketId);
  const publishedAt = new Date(now).toISOString();
  if (!candidate) {
    const latestPath = path.join(rootDirectory, 'data', 'latest', `${marketId}.json`);
    const statusPath = path.join(rootDirectory, 'data', 'status', 'markets', `${marketId}.json`);
    const [previousLatest, previousStatus] = await Promise.all([
      readJson(latestPath),
      readJson(statusPath, {})
    ]);
    await writeJsonAtomically(statusPath, {
      ...previousStatus,
      market: marketId,
      status: 'stale',
      reason: 'no_verified_raw_snapshot',
      updatedAt: publishedAt,
      capturedAt: previousLatest?.capturedAt || previousStatus?.capturedAt || null,
      sourcePath: previousLatest?.verification?.sourcePath || previousStatus?.sourcePath || '',
      producer: previousLatest?.verification?.producer || previousStatus?.producer || null,
      fallbackReason: 'no_verified_raw_snapshot',
      coverage: previousLatest?.verification?.coverage || previousStatus?.coverage || describeCoverage(previousLatest),
      latestQuoteAt: previousLatest?.verification?.latestQuoteAt || previousStatus?.latestQuoteAt || latestQuoteAt(previousLatest),
      freshnessSeconds: freshnessSeconds(previousLatest?.capturedAt || previousStatus?.capturedAt, now),
      freshnessEvaluatedAt: publishedAt,
      quoteFreshness: previousLatest?.verification?.quoteFreshness || previousStatus?.quoteFreshness || null,
      timezone: config.timezone
    });
    return { market: marketId, status: 'stale', reason: 'no_verified_raw_snapshot' };
  }
  const sourcePath = path.relative(rootDirectory, candidate.filePath).split(path.sep).join('/');
  const coverage = describeCoverage(candidate.snapshot);
  const quoteAt = latestQuoteAt(candidate.snapshot);
  const ageSeconds = freshnessSeconds(candidate.snapshot.capturedAt, now);
  const latest = {
    ...candidate.snapshot,
    publishedAt,
    verification: {
      status: 'verified', sourcePath, sourceSha256: createHash('sha256').update(candidate.content).digest('hex'),
      producer: candidate.snapshot.producer || { id: 'legacy', role: candidate.role },
      fallbackReason: candidate.role === 'backup' ? 'primary_missing_or_unverified_for_slot' : '',
      coverage,
      latestQuoteAt: quoteAt,
      freshnessSeconds: ageSeconds,
      freshnessEvaluatedAt: publishedAt,
      quoteFreshness: candidate.quoteFreshness
    }
  };
  await writeJsonAtomically(path.join(rootDirectory, 'data', 'latest', `${marketId}.json`), latest);
  await writeJsonAtomically(path.join(rootDirectory, 'data', 'status', 'markets', `${marketId}.json`), {
    market: marketId, status: 'healthy', updatedAt: latest.publishedAt, sourcePath,
    capturedAt: latest.capturedAt, producer: latest.verification.producer, fallbackReason: latest.verification.fallbackReason,
    coverage, latestQuoteAt: quoteAt, freshnessSeconds: ageSeconds, freshnessEvaluatedAt: publishedAt,
    quoteFreshness: candidate.quoteFreshness,
    timezone: config.timezone
  });
  return { market: marketId, status: 'published', sourcePath, producer: latest.verification.producer };
}

async function main() {
  if (!/^[a-z]{2,8}$/.test(market)) throw new Error('Usage: node src/cli/publish-market-latest.js <market>');
  console.log(JSON.stringify(await publishMarketLatest(root, market)));
}

const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isDirectRun) await main();

export { compareCandidates, describeCoverage, freshnessSeconds, latestQuoteAt, main, publishMarketLatest, selectLatestSnapshot };
