import assert from 'node:assert/strict';
import test from 'node:test';
import { buildYahooCollectionResult, collectYahooChartCollection, collectYahooCharts } from '../src/collectors/yahoo-chart-collector.js';

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
  return {
    ok, status,
    headers: { get: (name) => String(name).toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null },
    text: async () => JSON.stringify(payload), json: async () => payload
  };
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

test('collects all symbols when required indices fail, then marks the result non-publishable', async () => {
  const required = ['^GSPC', '^DJI', '^IXIC'];
  const symbols = [
    ...required.map((symbol) => ({ symbol, currency: 'USD' })),
    ...Array.from({ length: 39 }, (_, index) => ({ symbol: `STOCK${index}`, currency: 'USD' }))
  ];
  const requested = [];
  const collection = await collectYahooChartCollection(symbols, {
    timezone: 'America/New_York', now: NOW, requiredSymbols: required, maxAttempts: 1,
    fetchImpl: async (url) => {
      const symbol = decodeURIComponent(url.split('/').at(-1).split('?')[0]);
      requested.push(symbol);
      return required.includes(symbol)
        ? jsonResponse({ chart: { result: [{ indicators: { quote: [{ close: [1] }] } }] } })
        : jsonResponse(completePayload());
    }
  });

  assert.equal(requested.length, 42);
  assert.equal(collection.requestedSymbolCount, 42);
  assert.equal(collection.attemptedSymbolCount, 42);
  assert.equal(collection.capturedSymbolCount, 39);
  assert.equal(collection.failedSymbolCount, 3);
  assert.equal(collection.notAttemptedSymbolCount, 0);
  assert.deepEqual(collection.failedSymbols, required);
  assert.deepEqual(collection.notAttemptedSymbols, []);
  assert.equal(collection.collectionStatus, 'partial');
  assert.equal(collection.validationStatus, 'missing_required_symbols');
  assert.equal(collection.publishable, false);
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
    const collection = await collectYahooChartCollection([{ symbol: '^TEST', currency: 'USD' }], {
      timezone: 'America/New_York', fetchImpl: scenario.fetchImpl, maxAttempts: 1,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      diagnosticContext: { captureSlot: '09:05', workflowRunId: '123', producerId: 'primary-morning' }
    });
    assert.equal(collection.failedSymbolCount, 1, scenario.name);
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
    assert.equal('responsePreview' in (diagnostics[0].responseDiagnostic || {}), false);
    assert.equal('requestUrl' in (diagnostics[0].responseDiagnostic || {}), false);
    assert.equal('contentType' in (diagnostics[0].responseDiagnostic || {}), false);
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

test('preserves the default retry delay when callers omit an override', async () => {
  const waits = [];
  let calls = 0;
  const quotes = await collectYahooCharts([{ symbol: '^TEST', currency: 'USD' }], {
    timezone: 'America/New_York', now: NOW, retryJitterRatio: 0,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({}, { ok: false, status: 503 }) : jsonResponse(completePayload());
    },
    sleepImpl: async (milliseconds) => waits.push(milliseconds)
  });

  assert.equal(quotes.length, 1);
  assert.deepEqual(waits, [750]);
});

test('suppresses a retry that would exceed the approved capture deadline', async () => {
  const diagnostics = [];
  const waits = [];
  let clock = 0;
  let calls = 0;
  const collection = await collectYahooChartCollection([{ symbol: '^TEST', currency: 'USD' }], {
    timezone: 'America/New_York',
    fetchImpl: async () => { calls += 1; return jsonResponse({}, { ok: false, status: 503 }); },
    retryDelayMilliseconds: 100, maxRetryDelayMilliseconds: 1_000, retryJitterRatio: 0,
    deadlineAt: new Date(250).toISOString(), currentTime: () => clock,
    sleepImpl: async (milliseconds) => { waits.push(milliseconds); clock += milliseconds; },
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
  });

  assert.equal(calls, 2);
  assert.deepEqual(waits, [100]);
  assert.equal(diagnostics.at(-1).retrySuppressedReason, 'capture_deadline');
  assert.equal(diagnostics.at(-1).backoffMilliseconds, 0);
  assert.deepEqual(collection.failedSymbols, ['^TEST']);
});

test('does not retry non-retryable client HTTP failures', async () => {
  let calls = 0;
  const collection = await collectYahooChartCollection([{ symbol: '^TEST', currency: 'USD' }], {
    timezone: 'America/New_York',
    fetchImpl: async () => { calls += 1; return jsonResponse({}, { ok: false, status: 404 }); },
    retryDelayMilliseconds: 0
  });
  assert.equal(calls, 1);
  assert.deepEqual(collection.failedSymbols, ['^TEST']);
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

test('keeps an optional-symbol failure isolated while blocking an incomplete snapshot', async () => {
  const collection = await collectYahooChartCollection([
    { symbol: '^GSPC', currency: 'USD' }, { symbol: 'GOOD', currency: 'USD' }, { symbol: 'OPTIONAL', currency: 'USD' }
  ], {
    timezone: 'America/New_York', now: NOW, requiredSymbols: ['^GSPC'], maxAttempts: 1,
    fetchImpl: async (url) => url.includes('OPTIONAL')
      ? jsonResponse({ chart: { result: [{ indicators: { quote: [{ close: [1] }] } }] } })
      : jsonResponse(completePayload())
  });
  assert.equal(collection.attemptedSymbolCount, 3);
  assert.equal(collection.capturedSymbolCount, 2);
  assert.deepEqual(collection.failedSymbols, ['OPTIONAL']);
  assert.deepEqual(collection.missingRequiredSymbols, []);
  assert.equal(collection.validationStatus, 'incomplete_symbol_coverage');
  assert.equal(collection.publishable, false);
});

test('records a retryable malformed response then clears the symbol from final failures after success', async () => {
  const diagnostics = [];
  let calls = 0;
  const collection = await collectYahooChartCollection([{ symbol: '^GSPC', currency: 'USD' }], {
    timezone: 'America/New_York', now: NOW, requiredSymbols: ['^GSPC'], retryDelayMilliseconds: 0,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({ chart: { result: [{ meta: { symbol: '^GSPC' }, indicators: { quote: [{ close: [1] }] } }] } })
        : jsonResponse(completePayload());
    },
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
  });
  assert.equal(calls, 2);
  assert.deepEqual(collection.failedSymbols, []);
  assert.equal(collection.publishable, true);
  assert.equal(diagnostics[0].schemaStatus, 'missing_timestamp');
  assert.equal(diagnostics[0].responseDiagnostic.timestampType, 'undefined');
  assert.equal('responsePreview' in diagnostics[0].responseDiagnostic, false);
  assert.equal('requestUrl' in diagnostics[0].responseDiagnostic, false);
});

test('does not classify symbols that never started as failed', () => {
  const collection = buildYahooCollectionResult({
    symbols: [{ symbol: 'STARTED', currency: 'USD' }, { symbol: 'NOT_STARTED', currency: 'USD' }],
    requiredSymbols: ['STARTED'],
    outcomes: [{ symbol: 'STARTED', status: 'failed' }, { symbol: 'NOT_STARTED', status: 'not_attempted' }]
  });
  assert.equal(collection.attemptedSymbolCount, 1);
  assert.equal(collection.failedSymbolCount, 1);
  assert.equal(collection.notAttemptedSymbolCount, 1);
  assert.deepEqual(collection.failedSymbols, ['STARTED']);
  assert.deepEqual(collection.notAttemptedSymbols, ['NOT_STARTED']);
  assert.equal(collection.validationStatus, 'collection_interrupted');
});
