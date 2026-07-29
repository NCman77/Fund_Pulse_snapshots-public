import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHoldingSymbolIndex, normalizeHoldingName, resolveHoldingSymbol } from '../src/holdings/holding-symbol-mapper.js';

test('maps only explicitly approved public holding names', () => {
  const index = buildHoldingSymbolIndex([
    { name: '台積電', symbol: '2330.TW', market: 'tw', currency: 'TWD' },
    { name: 'NVIDIA CORP', symbol: 'NVDA', market: 'us', currency: 'USD' }
  ]);
  assert.equal(normalizeHoldingName(' NVIDIA-CORP '), normalizeHoldingName('NVIDIA CORP'));
  assert.equal(normalizeHoldingName('NVIDIA CORP-USA'), normalizeHoldingName('NVIDIA CORP'));
  assert.deepEqual(resolveHoldingSymbol('NVIDIA-CORP', index), { symbol: 'NVDA', market: 'us', currency: 'USD' });
  assert.equal(resolveHoldingSymbol('unreviewed holding', index), null);
});

test('rejects ambiguous approved public mappings', () => {
  assert.throws(() => buildHoldingSymbolIndex([
    { name: '台積電', symbol: '2330.TW', market: 'tw', currency: 'TWD' },
    { name: '台 積 電', symbol: 'TSM', market: 'us', currency: 'USD' }
  ]), /Duplicate approved public holding mapping/);
});
