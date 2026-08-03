import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomically } from '../storage/snapshot-writer.js';

const root = process.cwd();

async function readJson(filePath, fallback = null) {
  try { return JSON.parse(await readFile(filePath, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function main() {
  const marketEntries = await readdir(path.join(root, 'config', 'markets'), { withFileTypes: true });
  const previous = await readJson(path.join(root, 'data', 'status', 'market-health.json'), {});
  const health = {};
  for (const entry of marketEntries.filter((item) => item.isFile() && item.name.endsWith('.json'))) {
    const market = entry.name.replace(/\.json$/, '');
    const status = await readJson(path.join(root, 'data', 'status', 'markets', `${market}.json`));
    health[market] = status || { ...(previous?.[market] || {}), status: 'stale', reason: 'market_latest_not_published' };
  }
  await writeJsonAtomically(path.join(root, 'data', 'status', 'market-health.json'), health);
  console.log(JSON.stringify({ status: 'published', marketCount: Object.keys(health).length }));
}

await main();
