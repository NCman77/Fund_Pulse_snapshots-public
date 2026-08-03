import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { collectYahooCharts } from '../collectors/yahoo-chart-collector.js';
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

if (!config.enabled || config.source?.status !== 'approved') {
  console.log(JSON.stringify({ market, status: 'skipped', reason: 'collector-not-approved' }));
  process.exit(0);
}

const session = resolveMarketSession(config);
if (session === 'closed') {
  console.log(JSON.stringify({ market, status: 'skipped', reason: 'market-closed' }));
  process.exit(0);
}

try {
  const indices = JSON.parse(await readFile(path.join(root, 'config', 'public-symbols', 'indices.json'), 'utf8'));
  const approvedTickers = JSON.parse(await readFile(path.join(root, 'config', 'public-symbols', 'approved-public-tickers.json'), 'utf8'));
  const fxSymbols = JSON.parse(await readFile(path.join(root, 'config', 'public-symbols', 'fx.json'), 'utf8'));
  const holdingMappings = JSON.parse(await readFile(path.join(root, 'config', 'public-holdings', 'approved-holding-symbols.json'), 'utf8'));
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
  const quotes = await collectYahooCharts(uniqueSymbols, { timezone: config.timezone });
  const capturedAt = new Date();
  const producerId = String(process.env.CAPTURE_PRODUCER_ID || '').trim();
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
  console.log(JSON.stringify({ market, status: 'captured', path: path.relative(root, rawPath) }));
} catch {
  console.error(JSON.stringify({ market, status: 'failed', error: 'public-quote-collection-failed' }));
  process.exitCode = 1;
}
