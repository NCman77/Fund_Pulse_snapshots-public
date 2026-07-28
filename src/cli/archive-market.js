import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildDailyManifest } from '../storage/manifest-builder.js';
import { isMarketDayFinished } from '../scheduling/market-session-resolver.js';

const market = process.argv[2];
if (!market || !/^[a-z]{2,8}$/.test(market)) throw new Error('Usage: node src/cli/archive-market.js <market>');
const root = process.cwd();
const config = JSON.parse(await readFile(path.join(root, 'config', 'markets', `${market}.json`), 'utf8'));
if (!isMarketDayFinished(config)) {
  console.log(JSON.stringify({ market, status: 'skipped', reason: 'market-session-not-finished' }));
  process.exit(0);
}
const date = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
  .formatToParts(new Date())
  .filter(({ type }) => type !== 'literal')
  .reduce((result, { type, value }) => ({ ...result, [type]: value }), {});
const manifestDate = `${date.year}-${date.month}-${date.day}`;
const target = await buildDailyManifest(root, { market, region: config.region, date: manifestDate });
console.log(JSON.stringify({ market, status: target ? 'archived' : 'skipped', path: target && path.relative(root, target) }));
