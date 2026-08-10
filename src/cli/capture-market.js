import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { collectYahooChartCollection, describeYahooCollectorError } from '../collectors/yahoo-chart-collector.js';
import { createQuoteProvider } from '../providers/quote-provider.js';
import { resolveMarketSession } from '../scheduling/market-session-resolver.js';
import { buildCaptureTiming } from '../scheduling/scheduled-capture-timing.js';
import { writePartialCapture, writeSnapshot } from '../storage/snapshot-writer.js';
import { assessSnapshotQuoteFreshness } from '../quality/quote-freshness.js';
import { buildQuoteCollectionSummary } from '../quality/quote-collection-summary.js';

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
let selectedProvider = { id: 'yahoo-finance', endpointType: 'chart' };

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

function buildCollectionSummary(collection = {}) {
  return buildQuoteCollectionSummary(collection, {
    provider: selectedProvider.id,
    endpointType: selectedProvider.endpointType,
    expectedSymbolCount: expectedSymbols.length,
    requestedSymbolCount: expectedSymbols.length,
    attemptedSymbolCount: capturedSymbols.length,
    capturedSymbolCount: capturedSymbols.length,
    failedSymbolCount: 0,
    notAttemptedSymbolCount: Math.max(0, expectedSymbols.length - capturedSymbols.length),
    requestedSymbols: expectedSymbols,
    capturedSymbols,
    failedSymbols: [],
    notAttemptedSymbols: expectedSymbols.filter((symbol) => !capturedSymbols.includes(symbol)),
    collectionStatus: capturedSymbols.length === expectedSymbols.length ? 'complete' : 'partial',
    validationStatus: capturedSymbols.length === expectedSymbols.length ? 'valid' : 'collection_interrupted',
    publishable: capturedSymbols.length === expectedSymbols.length,
    complete: capturedSymbols.length === expectedSymbols.length
  });
}

try {
  const indices = JSON.parse(await readFile(path.join(root, 'config', 'public-symbols', 'indices.json'), 'utf8'));
  const approvedTickers = JSON.parse(await readFile(path.join(root, 'config', 'public-symbols', 'approved-public-tickers.json'), 'utf8'));
  const fxSymbols = JSON.parse(await readFile(path.join(root, 'config', 'public-symbols', 'fx.json'), 'utf8'));
  const holdingMappings = JSON.parse(await readFile(path.join(root, 'config', 'public-holdings', 'approved-holding-symbols.json'), 'utf8'));
  const retryPolicies = JSON.parse(await readFile(path.join(root, 'config', 'policies', 'retry-policy.json'), 'utf8'));
  const providerPolicy = JSON.parse(await readFile(path.join(root, 'config', 'policies', 'provider-selection.json'), 'utf8'));
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
  const requiredSymbols = Array.isArray(config.requiredSymbols) && config.requiredSymbols.length
    ? config.requiredSymbols.map((symbol) => String(symbol || '').trim()).filter(Boolean)
    : expectedSymbols;
  const optionalSymbols = Array.isArray(config.optionalSymbols)
    ? config.optionalSymbols.map((symbol) => String(symbol || '').trim()).filter(Boolean)
    : expectedSymbols.filter((symbol) => !requiredSymbols.includes(symbol));
  const declaredSymbols = [...requiredSymbols, ...optionalSymbols];
  if (new Set(declaredSymbols).size !== declaredSymbols.length || declaredSymbols.length !== expectedSymbols.length
    || declaredSymbols.some((symbol) => !expectedSymbols.includes(symbol))) {
    throw new Error(`Market ${market} must classify every approved symbol exactly once as required or optional.`);
  }
  const producerId = String(process.env.CAPTURE_PRODUCER_ID || '').trim();
  const scheduledAtMilliseconds = Date.parse(String(process.env.CAPTURE_SCHEDULED_AT || ''));
  const maximumCaptureDelaySeconds = Number(process.env.CAPTURE_MAX_DELAY_SECONDS || 120);
  const deadlineAt = Number.isFinite(scheduledAtMilliseconds)
    ? new Date(scheduledAtMilliseconds + (maximumCaptureDelaySeconds * 1_000)).toISOString()
    : undefined;
  const primaryProvider = createQuoteProvider({
    id: 'yahoo-finance',
    endpointType: 'chart',
    collect: (requestedSymbols, context) => collectYahooChartCollection(requestedSymbols, {
      timezone: config.timezone,
      requiredSymbols,
      optionalSymbols,
      maxAttempts: configuredNumber('YAHOO_CHART_MAX_ATTEMPTS', yahooPolicy.maxAttempts),
      retryDelayMilliseconds: configuredNumber('YAHOO_CHART_INITIAL_BACKOFF_MS', yahooPolicy.initialBackoffMilliseconds),
      maxRetryDelayMilliseconds: configuredNumber('YAHOO_CHART_MAX_BACKOFF_MS', yahooPolicy.maxBackoffMilliseconds),
      retryJitterRatio: configuredNumber('YAHOO_CHART_JITTER_RATIO', yahooPolicy.jitterRatio),
      maxConcurrency: configuredNumber('YAHOO_CHART_MAX_CONCURRENCY', yahooPolicy.maxConcurrency),
      timeoutMilliseconds: configuredNumber('YAHOO_CHART_TIMEOUT_MS', yahooPolicy.timeoutMilliseconds),
      deadlineAt: context.deadlineAt,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      diagnosticContext: {
        captureSlot: String(process.env.CAPTURE_SLOT || '').trim(),
        workflowRunId: String(process.env.GITHUB_RUN_ID || '').trim(),
        workflowRunAttempt: String(process.env.GITHUB_RUN_ATTEMPT || '').trim(),
        producerId
      }
    })
  });
  selectedProvider = { id: primaryProvider.id, endpointType: primaryProvider.endpointType };
  const collection = await primaryProvider.collect(uniqueSymbols, { deadlineAt });
  const quotes = collection.quotes;
  capturedSymbols = quotes.map(({ symbol }) => symbol);
  const coverage = buildCollectionSummary(collection);
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
    ),
    provider: selectedProvider,
    coverage,
    collectionStatus: coverage.collectionStatus,
    validationStatus: coverage.validationStatus,
    publishable: coverage.publishable,
    quotes,
    producer: producerId ? { id: producerId, role: producerRole === 'backup' ? 'backup' : 'primary' } : undefined
  };
  snapshot.quoteFreshness = assessSnapshotQuoteFreshness(snapshot, providerPolicy.quoteFreshness || {});
  const snapshotPath = coverage.publishable
    ? await writeSnapshot(root, snapshot)
    : await writePartialCapture(root, snapshot);
  console.log(JSON.stringify({
    market,
    status: coverage.publishable ? 'captured' : 'partial',
    path: path.relative(root, snapshotPath),
    collection: coverage,
    diagnostics
  }));
  if (!coverage.publishable) process.exitCode = 1;
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
