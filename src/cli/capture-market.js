import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { collectYahooCharts } from '../collectors/yahoo-chart-collector.js';
import { resolveMarketSession } from '../scheduling/market-session-resolver.js';
import { writeJsonAtomically, writeSnapshot } from '../storage/snapshot-writer.js';

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
  const symbols = JSON.parse(await readFile(path.join(root, 'config', 'public-symbols', 'indices.json'), 'utf8'));
  const quotes = await collectYahooCharts(symbols.markets[market] ?? [], { timezone: config.timezone });
  const snapshot = {
    schemaVersion: '1.0', market, region: config.region, capturedAt: new Date().toISOString(), session,
    source: config.source.name, isDelayed: true, quotes
  };
  const rawPath = await writeSnapshot(root, snapshot);
  await writeJsonAtomically(path.join(root, 'data', 'latest', `${market}.json`), snapshot);
  let health = {};
  try {
    health = JSON.parse(await readFile(path.join(root, 'data', 'status', 'market-health.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  health[market] = { status: 'healthy', lastSuccessAt: snapshot.capturedAt, source: config.source.name };
  await writeJsonAtomically(path.join(root, 'data', 'status', 'market-health.json'), {
    ...health
  });
  console.log(JSON.stringify({ market, status: 'captured', path: path.relative(root, rawPath) }));
} catch {
  console.error(JSON.stringify({ market, status: 'failed', error: 'public-quote-collection-failed' }));
  process.exitCode = 1;
}
