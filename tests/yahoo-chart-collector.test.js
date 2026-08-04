import assert from 'node:assert/strict';
import test from 'node:test';
import { collectYahooCharts } from '../src/collectors/yahoo-chart-collector.js';

const NOW = new Date('2026-07-28T14:00:00Z');

function completePayload(now = NOW, close = 102) {
  return {
    chart: { result: [{
      timestamp: [Math.floor(now.getTime() / 1_000)],
      meta: { regularMarketPreviousClose: 100 },
      indicators: { quote: [{ open: [101], high: [103], low: [99], close: [close] }] }
    }] }
  };
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

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

test('classifies retryable HTTP, timeout, non-JSON, and schema failures without response bodies', async () => {
  const cases = [
    {
      name: 'rate limited',
      fetchImpl: async () => jsonResponse({}, { ok: false, status: 429 }),
      expected: { errorClass: 'http_error', httpStatus: 429, schemaStatus: 'not_checked', retryable: true }
    },
    {
      name: 'upstream unavailable',
      fetchImpl: async () => jsonResponse({}, { ok: false, status: 503 }),
      expected: { errorClass: 'http_error', httpStatus: 503, schemaStatus: 'not_checked', retryable: true }
    },
    {
      name: 'timeout',
      fetchImpl: async () => { throw new DOMException('timed out', 'TimeoutError'); },
      expected: { errorClass: 'timeout', httpStatus: null, schemaStatus: 'not_checked', retryable: true }
    },
    {
      name: 'non JSON',
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('private response text'); } }),
      expected: { errorClass: 'invalid_json', httpStatus: 200, schemaStatus: 'invalid_json', retryable: true }
    },
    {
      name: 'missing timestamp',
      fetchImpl: async () => jsonResponse({ chart: { result: [{ indicators: { quote: [{ close: [1] }] } }] } }),
      expected: { errorClass: 'schema_error', httpStatus: 200, schemaStatus: 'missing_timestamp', retryable: true }
    },
    {
      name: 'missing close',
      fetchImpl: async () => jsonResponse({ chart: { result: [{ timestamp: [1], indicators: { quote: [{}] } }] } }),
      expected: { errorClass: 'schema_error', httpStatus: 200, schemaStatus: 'missing_close', retryable: true }
    }
  ];

  for (const scenario of cases) {
    const diagnostics = [];
    await assert.rejects(
      collectYahooCharts([{ symbol: '^TEST', currency: 'USD' }], {
        timezone: 'America/New_York',
        fetchImpl: scenario.fetchImpl,
        maxAttempts: 1,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
        diagnosticContext: { captureSlot: '09:05', workflowRunId: '123', producerId: 'primary-morning' }
      }),
      Error,
      scenario.name
    );
    assert.deepEqual(
      diagnostics.map(({ errorClass, httpStatus, schemaStatus, retryable }) => ({ errorClass, httpStatus, schemaStatus, retryable })),
      [scenario.expected],
      scenario.name
    );
    assert.equal(diagnostics[0].provider, 'yahoo-finance');
    assert.equal(diagnostics[0].endpointType, 'chart');
    assert.equal(diagnostics[0].captureSlot, '09:05');
    assert.equal(diagnostics[0].workflowRunId, '123');
    assert.equal('responseBody' in diagnostics[0], false);
  }
});

test('uses capped exponential backoff with jitter before retrying', async () => {
  const waits = [];
  let calls = 0;
  const quotes = await collectYahooCharts([{ symbol: '^TEST', currency: 'USD' }], {
    timezone: 'America/New_York',
    now: NOW,
    fetchImpl: async () => {
      calls += 1;
      return calls < 3
        ? jsonResponse({}, { ok: false, status: 503 })
        : jsonResponse(completePayload());
    },
    retryDelayMilliseconds: 100,
    maxRetryDelayMilliseconds: 150,
    retryJitterRatio: 0.5,
    random: () => 0.4,
    sleepImpl: async (milliseconds) => waits.push(milliseconds)
  });

  assert.equal(quotes[0].close, 102);
  assert.deepEqual(waits, [120, 180]);
});

test('suppresses a retry that would exceed the approved capture deadline', async () => {
  const diagnostics = [];
  const waits = [];
  let clock = 0;
  let calls = 0;
  await assert.rejects(
    collectYahooCharts([{ symbol: '^TEST', currency: 'USD' }], {
      timezone: 'America/New_York',
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({}, { ok: false, status: 503 });
      },
      retryDelayMilliseconds: 100,
      maxRetryDelayMilliseconds: 1_000,
      retryJitterRatio: 0,
      deadlineAt: new Date(250).toISOString(),
      currentTime: () => clock,
      sleepImpl: async (milliseconds) => {
        waits.push(milliseconds);
        clock += milliseconds;
      },
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
    }),
    /HTTP 503/
  );

  assert.equal(calls, 2);
  assert.deepEqual(waits, [100]);
  assert.equal(diagnostics.at(-1).retrySuppressedReason, 'capture_deadline');
  assert.equal(diagnostics.at(-1).backoffMilliseconds, 0);
});

test('does not retry non-retryable client HTTP failures', async () => {
  let calls = 0;
  await assert.rejects(
    collectYahooCharts([{ symbol: '^TEST', currency: 'USD' }], {
      timezone: 'America/New_York',
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({}, { ok: false, status: 404 });
      },
      retryDelayMilliseconds: 0
    }),
    /HTTP 404/
  );
  assert.equal(calls, 1);
});

test('enforces the configured Yahoo request concurrency limit', async () => {
  let active = 0;
  let peak = 0;
  const symbols = Array.from({ length: 7 }, (_, index) => ({ symbol: `TEST${index}`, currency: 'USD' }));
  const quotes = await collectYahooCharts(symbols, {
    timezone: 'America/New_York',
    now: NOW,
    maxConcurrency: 2,
    fetchImpl: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return jsonResponse(completePayload());
    }
  });

  assert.equal(quotes.length, symbols.length);
  assert.equal(peak, 2);
});

test('reports optional-symbol failure diagnostics while preserving successful quotes', async () => {
  const diagnostics = [];
  const quotes = await collectYahooCharts([
    { symbol: 'GOOD', currency: 'USD' },
    { symbol: 'MISSING', currency: 'USD' }
  ], {
    timezone: 'America/New_York',
    now: NOW,
    maxAttempts: 1,
    fetchImpl: async (url) => url.includes('GOOD')
      ? jsonResponse(completePayload())
      : jsonResponse({ chart: { result: [{ timestamp: [1], indicators: { quote: [{}] } }] } }),
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
  });

  assert.deepEqual(quotes.map(({ symbol }) => symbol), ['GOOD']);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].symbol, 'MISSING');
  assert.equal(diagnostics[0].finalAttempt, true);
});
