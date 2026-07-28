import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMarketSession } from '../src/scheduling/market-session-resolver.js';

const china = {
  timezone: 'Asia/Shanghai',
  sessions: { regular: [{ open: '09:30', close: '11:30' }, { open: '13:00', close: '15:00' }] }
};

test('respects market timezones and lunch breaks', () => {
  assert.equal(resolveMarketSession(china, new Date('2026-07-28T02:00:00Z')), 'regular');
  assert.equal(resolveMarketSession(china, new Date('2026-07-28T04:00:00Z')), 'closed');
  assert.equal(resolveMarketSession(china, new Date('2026-07-26T02:00:00Z')), 'closed');
});
