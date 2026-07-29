import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveMarketSession } from '../src/scheduling/market-session-resolver.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadMarket(market) {
  return JSON.parse(await readFile(path.join(root, 'config', 'markets', `${market}.json`), 'utf8'));
}

test('every enabled market has a reviewed exchange-calendar source', async () => {
  const markets = await Promise.all(['tw', 'jp', 'kr', 'cn', 'sg', 'uk', 'eu', 'us'].map(loadMarket));
  for (const market of markets) {
    assert.equal(market.enabled, true);
    assert.match(market.calendar.reviewedAt, /^2026-\d{2}-\d{2}$/);
    assert.match(market.calendar.sourceUrl, /^https:\/\//);
    assert.ok(Array.isArray(market.calendar.closedDates));
    assert.equal(new Set(market.calendar.closedDates).size, market.calendar.closedDates.length);
  }
});

test('configured 2026 exchange closures and early closes suppress collection', async () => {
  const [tw, jp, kr, cn, sg, uk, eu, us] = await Promise.all(['tw', 'jp', 'kr', 'cn', 'sg', 'uk', 'eu', 'us'].map(loadMarket));
  assert.equal(resolveMarketSession(tw, new Date('2026-09-25T03:00:00Z')), 'closed');
  assert.equal(resolveMarketSession(jp, new Date('2026-09-21T01:00:00Z')), 'closed');
  assert.equal(resolveMarketSession(kr, new Date('2026-10-09T02:00:00Z')), 'closed');
  assert.equal(resolveMarketSession(cn, new Date('2026-10-01T02:00:00Z')), 'closed');
  assert.equal(resolveMarketSession(sg, new Date('2026-12-25T02:00:00Z')), 'closed');
  assert.equal(resolveMarketSession(uk, new Date('2026-12-24T13:00:00Z')), 'closed');
  assert.equal(resolveMarketSession(eu, new Date('2026-12-31T13:30:00Z')), 'closed');
  assert.equal(resolveMarketSession(us, new Date('2026-11-27T19:00:00Z')), 'closed');
});
