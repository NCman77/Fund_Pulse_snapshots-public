import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { collectYahooCharts, describeYahooCollectorError } from '../collectors/yahoo-chart-collector.js';
import { resolveMarketSession } from '../scheduling/market-session-resolver.js';
import { buildCaptureTiming } from '../scheduling/scheduled-capture-timing.js';
import { writeSnapshot } from '../storage/snapshot-writer.js';

const market = process.argv[2];
if (!market || !/^[a-z]{2,8}$/.test(market)) {
  throw new Error('Usage: node src/cli/capture-market.js <market>');
}

const root = process.cwd();
const configPath = path.join(root, 'config', 'markets', `${market}.json`);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const diagnostics = [];
let expectedSymbols = [];
let capturedSymbols = [];

if (!config.enabled || config.source?.status !== 'approved') {
  console.log(JSON.stringify({ market, status: 'skipped', reason: 'collector-not-approved' }));
  process.exit(0);
}

const session = resolveMarketSession(config);
if (session === 'closed') {
  console.log(JSON.stringify({ market, status: 'skipped', reason: 'market-closed' }));
  process.exit(0);
}

function configuredNumber(environmentName, configuredValue) {
  const environmentValue = process.env[environmentName];
  return environmentValue === undefined ? configuredValue : Number(environmentValue);
}

function buildCollectionSummary() {
  const captured = new Set(capturedSymbols);
  const finalFailures = new Set(
    diagnostics.filter((diagnostic) => diagnostic.finalAttempt).map((diagnostic) => diagnostic.symbol)
  );
  return {
    provider: 'yahoo-finance',
    endpointType: 'chart',
    expectedSymbolCount: expectedSymbols.length,
    capturedSymbolCount: captured.size,
    failedSymbols: expectedSymbols.filter((symbol) => finalFailures.has(symbol) || !captured.has(symbol))
  };
}

try {
  const indices = JSON.parse(await readFile(path.join(root, 'config', 'public-symbols', 'indices.json'), 'utf8'));
  const approvedTickers = JSON.parse(await readFile(path.join(root, 'config', 'public-symbols', 'approved-public-tickers.json'), 'utf8'));
  const fxSymbols = JSON.parse(await readFile(path.join(root, 'config', 'public-symbols', 'fx.json'), 'utf8'));
  const holdingMappings = JSON.parse(await readFile(path.join(root, 'config', 'public-holdings', 'approved-holding-symbols.json'), 'utf8'));
  const retryPolicies = JSON.parse(await readFile(path.join(root, 'config', 'policies', 'retry-policy.json'), 'utf8'));
  const yahooPolicy = retryPolicies.yahooChart || {};
  const holdingSymbols = (holdingMappings.mappings ?? [])
    .filter((mapping) => mapping.market === market)
    .map(({ symbol, currency }) => ({ symbol, currency }));
  // FX is intentionally captured alongside every market snapshot. It is a
  // public input to cross-market NAV replay, not a private model parameter.
  const symbols = [
    ...(indices.markets[market] ?? []),
    ...(approvedTickers.markets[market] ?? []),
    ...holdingSymbols,
    ...(fxSymbols.symbols ?? [])
  ];
  const uniqueSymbols = Array.from(new Map(symbols.map((item) => [item.symbol, item])).values());
  expectedSymbols = uniqueSymbols.map(({ symbol }) => symbol);
  const producerId = String(process.env.CAPTURE_PRODUCER_ID || '').trim();
  const scheduledAtMilliseconds = Date.parse(String(process.env.CAPTURE_SCHEDULED_AT || ''));
  const maximumCaptureDelaySeconds = Number(process.env.CAPTURE_MAX_DELAY_SECONDS || 120);
  const deadlineAt = Number.isFinite(scheduledAtMilliseconds)
    ? new Date(scheduledAtMilliseconds + (maximumCaptureDelaySeconds * 1_000)).toISOString()
    : undefined;
  const quotes = await collectYahooCharts(uniqueSymbols, {
    timezone: config.timezone,
    maxAttempts: configuredNumber('YAHOO_CHART_MAX_ATTEMPTS', yahooPolicy.maxAttempts),
    retryDelayMilliseconds: configuredNumber('YAHOO_CHART_INITIAL_BACKOFF_MS', yahooPolicy.initialBackoffMilliseconds),
    maxRetryDelayMilliseconds: configuredNumber('YAHOO_CHART_MAX_BACKOFF_MS', yahooPolicy.maxBackoffMilliseconds),
    retryJitterRatio: configuredNumber('YAHOO_CHART_JITTER_RATIO', yahooPolicy.jitterRatio),
    maxConcurrency: configuredNumber('YAHOO_CHART_MAX_CONCURRENCY', yahooPolicy.maxConcurrency),
    timeoutMilliseconds: configuredNumber('YAHOO_CHART_TIMEOUT_MS', yahooPolicy.timeoutMilliseconds),
    deadlineAt,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    diagnosticContext: {
      captureSlot: String(process.env.CAPTURE_SLOT || '').trim(),
      workflowRunId: String(process.env.GITHUB_RUN_ID || '').trim(),
      workflowRunAttempt: String(process.env.GITHUB_RUN_ATTEMPT || '').trim(),
      producerId
    }
  });
  capturedSymbols = quotes.map(({ symbol }) => symbol);
  const capturedAt = new Date();
  const producerRole = String(process.env.CAPTURE_PRODUCER_ROLE || 'primary').trim();
  const snapshot = {
    schemaVersion: '1.2', market, region: config.region, capturedAt: capturedAt.toISOString(), session,
    source: config.source.name, isDelayed: true, quoteStatus: 'current_market_date',
    scheduleRule: process.env.CAPTURE_SCHEDULE_RULE || null,
    ...buildCaptureTiming(
      process.env.CAPTURE_SCHEDULE_RULE,
      capturedAt,
      Number(process.env.CAPTURE_MAX_DELAY_SECONDS || 120),
      process.env.CAPTURE_SCHEDULED_AT
    ), quotes,
    producer: producerId ? { id: producerId, role: producerRole === 'backup' ? 'backup' : 'primary' } : undefined
  };
  const rawPath = await writeSnapshot(root, snapshot);
  console.log(JSON.stringify({
    market,
    status: 'captured',
    path: path.relative(root, rawPath),
    collection: buildCollectionSummary(),
    diagnostics
  }));
} catch (error) {
  console.log(JSON.stringify({
    market,
    status: 'failed',
    error: 'public-quote-collection-failed',
    failure: describeYahooCollectorError(error),
    collection: buildCollectionSummary(),
    diagnostics
  }));
  process.exitCode = 1;
}
