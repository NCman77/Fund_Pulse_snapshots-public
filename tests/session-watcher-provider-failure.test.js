import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyProviderFailure } from '../src/cli/watch-market-session.js';

test('classifies a widespread final missing-timestamp response as a batch schema failure', () => {
  const result = classifyProviderFailure(
    { requestedSymbolCount: 68, capturedSymbolCount: 0 },
    Array.from({ length: 68 }, () => ({
      finalAttempt: true,
      errorClass: 'schema_error',
      schemaStatus: 'missing_timestamp',
    })),
  );

  assert.equal(result, 'provider_batch_schema_failure');
});

test('classifies partial widespread missing timestamps as provider schema degradation', () => {
  const result = classifyProviderFailure(
    { requestedSymbolCount: 11, capturedSymbolCount: 7 },
    Array.from({ length: 4 }, () => ({
      finalAttempt: true,
      errorClass: 'schema_error',
      schemaStatus: 'missing_timestamp',
    })),
  );

  assert.equal(result, 'provider_schema_degradation');
});
