import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQuoteCollectionSummary } from '../src/quality/quote-collection-summary.js';

test('keeps persisted coverage backward compatible and excludes transient payloads', () => {
  const summary = buildQuoteCollectionSummary({
    provider: 'yahoo-finance', endpointType: 'chart',
    requestedSymbolCount: 2, attemptedSymbolCount: 2, capturedSymbolCount: 1,
    failedSymbolCount: 1, requestedSymbols: ['GOOD', 'MISSING'], capturedSymbols: ['GOOD'],
    failedSymbols: ['MISSING'], requiredSymbols: ['GOOD'], optionalSymbols: ['MISSING'],
    missingRequiredSymbols: [], collectionStatus: 'partial', validationStatus: 'incomplete_symbol_coverage',
    publishable: false, complete: false,
    quotes: [{ symbol: 'GOOD', close: 100 }],
    outcomes: [{ symbol: 'MISSING', failure: { responseDiagnostic: { responsePreview: 'must not persist' } } }],
    diagnostics: [{ responseBody: 'must not persist' }]
  });

  assert.equal(summary.expectedSymbolCount, 2);
  assert.equal(summary.requestedSymbolCount, 2);
  assert.equal(summary.capturedSymbolCount, 1);
  assert.equal(summary.publishable, false);
  assert.equal('quotes' in summary, false);
  assert.equal('outcomes' in summary, false);
  assert.equal('diagnostics' in summary, false);
  assert.doesNotMatch(JSON.stringify(summary), /must not persist/);
});

test('normalizes legacy expectedSymbolCount coverage without changing eligibility', () => {
  const summary = buildQuoteCollectionSummary({
    provider: 'yahoo-finance', endpointType: 'chart',
    expectedSymbolCount: 2, capturedSymbolCount: 2, failedSymbols: [], complete: true
  });

  assert.equal(summary.expectedSymbolCount, 2);
  assert.equal(summary.requestedSymbolCount, 2);
  assert.equal(summary.complete, true);
  assert.equal(summary.publishable, true);
});
