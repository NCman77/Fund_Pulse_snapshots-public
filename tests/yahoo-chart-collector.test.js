import assert from 'node:assert/strict';
import test from 'node:test';
import { collectYahooCharts } from '../src/collectors/yahoo-chart-collector.js';

test('preserves raw quote fields needed by private training', async () => {
  const now = new Date('2026-07-28T14:00:00Z');
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      chart: { result: [{
        timestamp: [Math.floor(now.getTime() / 1_000)],
        meta: { regularMarketPreviousClose: 100 },
        indicators: { quote: [{ open: [101], high: [103], low: [99], close: [102] }] }
      }] }
    })
  });
  const [quote] = await collectYahooCharts([{ symbol: 'TEST', currency: 'USD' }], {
    timezone: 'America/New_York', now, fetchImpl
  });
  assert.deepEqual(quote, {
    symbol: 'TEST', open: 101, high: 103, low: 99, close: 102, previousClose: 100,
    quoteAt: now.toISOString(), currency: 'USD'
  });
});

test('retries an incomplete Yahoo chart response before accepting a quote', async () => {
  const now = new Date('2026-07-28T14:00:00Z');
  let calls = 0;
  const fetchImpl = async () => ({
    ok: true,
    json: async () => {
      calls += 1;
      if (calls === 1) return { chart: { result: [{ timestamp: [Math.floor(now.getTime() / 1_000)], indicators: { quote: [{}] } }] } };
      return { chart: { result: [{
        timestamp: [Math.floor(now.getTime() / 1_000)],
        meta: { previousClose: 100 },
        indicators: { quote: [{ open: [101], high: [103], low: [99], close: [102] }] }
      }] } };
    }
  });
  const quotes = await collectYahooCharts([{ symbol: '^TEST', currency: 'USD' }], {
    timezone: 'America/New_York', now, fetchImpl, retryDelayMilliseconds: 0
  });
  assert.equal(calls, 2);
  assert.equal(quotes[0].close, 102);
});

test('fails a required index clearly when Yahoo keeps omitting the close series', async () => {
  await assert.rejects(
    collectYahooCharts([{ symbol: '^TEST', currency: 'USD' }], {
      timezone: 'America/New_York',
      fetchImpl: async () => ({ ok: true, json: async () => ({ chart: { result: [{ timestamp: [1], indicators: { quote: [{}] } }] } }) }),
      retryDelayMilliseconds: 0
    }),
    /missing timestamp or close series/
  );
});
