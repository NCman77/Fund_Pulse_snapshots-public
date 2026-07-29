import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAIWAN_REFERENCE_SYMBOLS = ['^TWII', 'IX0043.TWO', 'SEC.TW', 'EPC.TW', 'IX0054.TWO', 'OTE.TW', 'COI.TW', 'BIM.TW', '^TMAI'];

test('collects the reviewed public Taiwan reference series needed for reproducible private replay', async () => {
  const indices = JSON.parse(await readFile(path.join(ROOT, 'config', 'public-symbols', 'indices.json'), 'utf8'));
  const collected = new Set((indices.markets.tw || []).map((entry) => entry.symbol));
  assert.deepEqual(TAIWAN_REFERENCE_SYMBOLS.filter((symbol) => !collected.has(symbol)), []);
});

test('keeps the reviewed public 愛普 mapping available to the Taiwan collector', async () => {
  const mappings = JSON.parse(await readFile(path.join(ROOT, 'config', 'public-holdings', 'approved-holding-symbols.json'), 'utf8'));
  assert.deepEqual(mappings.mappings.find((entry) => entry.name === '愛普*'), {
    name: '愛普*', symbol: '6531.TW', market: 'tw', currency: 'TWD'
  });
});
