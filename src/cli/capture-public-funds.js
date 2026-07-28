import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { collectMoneyDjFundDisclosure } from '../collectors/moneydj-fund-collector.js';
import { writeJsonAtomically } from '../storage/snapshot-writer.js';

const root = process.cwd();
const catalog = JSON.parse(await readFile(path.join(root, 'config', 'public-funds', 'approved-funds.json'), 'utf8'));
const healthPath = path.join(root, 'data', 'status', 'fund-disclosure-health.json');
let health = {};
try { health = JSON.parse(await readFile(healthPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }

let failures = 0;
for (const fund of catalog.funds ?? []) {
  try {
    const disclosure = await collectMoneyDjFundDisclosure(fund);
    const date = disclosure.capturedAt.slice(0, 10);
    const time = disclosure.capturedAt.slice(11, 16).replace(':', '');
    const rawPath = path.join(root, 'data', 'funds', 'raw', disclosure.fundId, date.slice(0, 4), date, `${time}.json`);
    await writeJsonAtomically(rawPath, disclosure);
    await writeJsonAtomically(path.join(root, 'data', 'funds', 'latest', `${disclosure.fundId}.json`), disclosure);
    health[disclosure.fundId] = { status: 'healthy', lastSuccessAt: disclosure.capturedAt, source: disclosure.source.name };
    console.log(JSON.stringify({ fundId: disclosure.fundId, status: 'captured', holdingCount: disclosure.holdingsDisclosure.holdings.length }));
  } catch {
    failures += 1;
    health[fund.fundId] = { status: 'failed', lastFailureAt: new Date().toISOString(), source: 'moneydj-public' };
    console.error(JSON.stringify({ fundId: fund.fundId, status: 'failed', error: 'public-fund-disclosure-collection-failed' }));
  }
}
await writeJsonAtomically(healthPath, health);
if (failures) process.exitCode = 1;

