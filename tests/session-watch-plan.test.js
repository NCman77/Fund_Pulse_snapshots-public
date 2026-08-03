import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSessionWatchPlan, localSlotToUtc, normalizeSlots } from '../src/scheduling/session-watch-plan.js';

const taiwan = {
  market: 'tw', timezone: 'Asia/Taipei',
  sessions: { regular: [{ open: '09:00', close: '13:30' }] },
  calendar: { specialSessions: {} }
};

test('builds an ordered Taiwan session-watch plan using only regular-session slots', () => {
  const plan = buildSessionWatchPlan(taiwan, '12:55,09:05,13:30', new Date('2026-07-28T00:35:00.000Z'));
  assert.equal(plan.localDate, '2026-07-28');
  assert.deepEqual(plan.slots, ['09:05', '12:55', '13:30']);
});

test('filters slots outside a reviewed early-close session', () => {
  const earlyCloseMarket = {
    ...taiwan,
    calendar: { specialSessions: { '2026-07-28': [{ open: '09:00', close: '12:30' }] } }
  };
  const plan = buildSessionWatchPlan(earlyCloseMarket, '09:05,13:00', new Date('2026-07-28T00:35:00.000Z'));
  assert.deepEqual(plan.slots, ['09:05']);
  assert.deepEqual(plan.skippedSlots, ['13:00']);
});

test('skips a reviewed market closure without waiting for the session slots', () => {
  const closedMarket = { ...taiwan, calendar: { closedDates: ['2026-07-28'], specialSessions: {} } };
  const plan = buildSessionWatchPlan(closedMarket, '09:05', new Date('2026-07-28T00:35:00.000Z'));
  assert.equal(plan.isTradingDay, false);
});

test('converts a Taipei local capture slot to its intended UTC instant', () => {
  const scheduledAt = localSlotToUtc('2026-07-28', '12:55', 'Asia/Taipei', new Date('2026-07-28T00:35:00.789Z'));
  assert.equal(scheduledAt.toISOString(), '2026-07-28T04:55:00.000Z');
  assert.deepEqual(normalizeSlots(['13:30', '09:05', '09:05']), ['09:05', '13:30']);
});
