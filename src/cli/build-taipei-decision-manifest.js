import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMarketSession } from '../scheduling/market-session-resolver.js';
import { buildFundDecisionCoverage } from '../decision/fund-decision-coverage.js';
import { writeJsonAtomically } from '../storage/snapshot-writer.js';
import { assessQuoteFreshness } from '../quality/quote-freshness.js';

const MARKET_IDS = ['tw', 'jp', 'kr', 'cn', 'sg', 'uk', 'eu', 'us'];
const TAIPEI_TIMEZONE = 'Asia/Taipei';
const MAX_DELAY_SECONDS = 120;

function taipeiDate(value = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function decisionAt(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('Decision manifest requires YYYY-MM-DD date.');
  return new Date(`${date}T12:55:00+08:00`);
}

async function walkJson(directory) {
  let entries = [];
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkJson(target);
    return entry.isFile() && entry.name.endsWith('.json') ? [target] : [];
  }));
  return nested.flat();
}

async function readJson(filePath, fallback = null) {
  try { return JSON.parse(await readFile(filePath, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function findLatestSnapshot(root, market, config, cutoffMs) {
  const directory = path.join(root, 'data', 'raw', config.region, market);
  const candidates = [];
  for (const filePath of await walkJson(directory)) {
    const content = await readFile(filePath);
    const snapshot = JSON.parse(content);
    const capturedMs = new Date(snapshot?.capturedAt || '').getTime();
    const scheduledMs = new Date(snapshot?.scheduledAt || snapshot?.capturedAt || '').getTime();
    const coverageComplete = snapshot?.coverage === undefined || snapshot?.coverage?.complete === true;
    if (snapshot?.market !== market || !Number.isFinite(capturedMs) || !Number.isFinite(scheduledMs)
      || capturedMs > cutoffMs || scheduledMs > cutoffMs || !coverageComplete) continue;
    candidates.push({
      filePath, content, snapshot, capturedMs, scheduledMs, config,
      role: snapshot?.producer?.role === 'backup' ? 'backup' : 'primary'
    });
  }
  candidates.sort((left, right) => (
    left.scheduledMs - right.scheduledMs
      || (left.role === right.role ? 0 : left.role === 'primary' ? 1 : -1)
      || left.capturedMs - right.capturedMs
      || left.filePath.localeCompare(right.filePath)
  ));
  return candidates.at(-1) || null;
}

function quoteRange(quotes = []) {
  const values = quotes.map((quote) => new Date(quote?.quoteAt || '').getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    earliestQuoteAt: values.length ? new Date(values[0]).toISOString() : '',
    latestQuoteAt: values.length ? new Date(values.at(-1)).toISOString() : ''
  };
}

async function buildTaipeiDecisionManifest(root, { date = taipeiDate(), now = new Date() } = {}) {
  const at = decisionAt(date);
  const cutoff = new Date(at.getTime() + MAX_DELAY_SECONDS * 1_000);
  const providerPolicy = await readJson(path.join(root, 'config', 'policies', 'provider-selection.json'), {});
  const maximumQuoteAge = Number(providerPolicy?.criticalDecisionSlot?.maxQuoteAgeSeconds);
  const entries = [];
  for (const market of MARKET_IDS) {
    const config = JSON.parse(await readFile(path.join(root, 'config', 'markets', `${market}.json`), 'utf8'));
    const sessionAtDecision = resolveMarketSession(config, at);
    // An active market can contribute a capture that finishes within the
    // decision tolerance. A closed market may only contribute information
    // that already existed at 12:55; never let a later reopening leak in.
    const latest = await findLatestSnapshot(root, market, config, (sessionAtDecision === 'regular' ? cutoff : at).getTime());
    if (!latest) {
      entries.push({ market, marketStateAtDecision: sessionAtDecision, status: 'missing_snapshot' });
      continue;
    }
    const snapshot = latest.snapshot;
    const delay = Number(snapshot.captureDelaySeconds);
    const isLiveDecisionCapture = sessionAtDecision === 'regular'
      && latest.capturedMs >= at.getTime()
      && latest.capturedMs <= cutoff.getTime()
      && Number.isFinite(delay)
      && delay <= MAX_DELAY_SECONDS;
    const quoteFreshness = assessQuoteFreshness(snapshot.quotes, {
      referenceAt: at,
      maxAgeSeconds: sessionAtDecision === 'regular' && Number.isFinite(maximumQuoteAge) ? maximumQuoteAge : null,
      maximumFutureSkewSeconds: providerPolicy?.quoteFreshness?.maximumFutureSkewSeconds
    });
    entries.push({
      market,
      marketStateAtDecision: sessionAtDecision,
      status: isLiveDecisionCapture ? 'decision_window_capture' : 'latest_available_before_decision',
      path: path.relative(root, latest.filePath).split(path.sep).join('/'),
      sha256: createHash('sha256').update(latest.content).digest('hex'),
      capturedAt: snapshot.capturedAt,
      scheduledAt: snapshot.scheduledAt || '',
      captureDelaySeconds: Number.isFinite(delay) ? delay : null,
      timingStatus: snapshot.timingStatus || 'unknown',
      quoteCount: Array.isArray(snapshot.quotes) ? snapshot.quotes.length : 0,
      quoteFreshness,
      ...quoteRange(snapshot.quotes)
    });
  }
  const openMarkets = entries.filter((entry) => entry.marketStateAtDecision === 'regular');
  const timingWithinTolerance = openMarkets.length > 0 && openMarkets.every((entry) => entry.status === 'decision_window_capture');
  const dataQualityWithinTolerance = openMarkets.length > 0
    && openMarkets.every((entry) => entry.status === 'decision_window_capture' && entry.quoteFreshness?.complete === true);
  const [holdingCoverage, fundCoveragePolicy] = await Promise.all([
    readJson(path.join(root, 'data', 'funds', 'coverage', 'latest.json')),
    readJson(path.join(root, 'config', 'policies', 'fund-decision-coverage.json'))
  ]);
  const fundCoverage = holdingCoverage && fundCoveragePolicy
    ? await buildFundDecisionCoverage({
        root,
        decisionAt: at.toISOString(),
        decisionWindowEndsAt: cutoff.toISOString(),
        marketEntries: entries,
        holdingCoverage,
        policy: fundCoveragePolicy
      })
    : {
        schemaVersion: '1.0', mode: fundCoveragePolicy?.mode || 'formal_gate', scope: 'disclosed_holdings_only',
        status: 'unavailable', reason: 'holding_coverage_or_policy_missing', fundCount: 0, eligibleFundCount: 0, funds: []
      };
  const manifest = {
    schemaVersion: '1.0',
    basis: 'taipei_1255_pre_order',
    date,
    decisionAt: at.toISOString(),
    decisionWindowEndsAt: cutoff.toISOString(),
    generatedAt: now.toISOString(),
    maxOpenMarketDelaySeconds: MAX_DELAY_SECONDS,
    timingWithinTolerance,
    dataQualityWithinTolerance,
    fundCoverage,
    markets: entries
  };
  const target = path.join(root, 'data', 'decision-snapshots', date.slice(0, 4), date, 'taipei-1255.json');
  await writeJsonAtomically(target, manifest);
  return { target, manifest };
}

const requestedDate = process.argv.find((arg) => arg.startsWith('--date='))?.slice('--date='.length);
const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isDirectRun) {
  const result = await buildTaipeiDecisionManifest(process.cwd(), { date: requestedDate || taipeiDate() });
  console.log(JSON.stringify({ status: 'built', path: path.relative(process.cwd(), result.target), timingWithinTolerance: result.manifest.timingWithinTolerance }));
}

export { buildTaipeiDecisionManifest, decisionAt, taipeiDate };
