import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildQuoteCollectionSummary } from './quote-collection-summary.js';

function normalizeSeedPaths(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)));
}

function isWithinDirectory(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function quoteTimestamp(quote) {
  const parsed = Date.parse(String(quote?.quoteAt || ''));
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function mergeQuotesBySymbol(expectedSymbols, ...quoteGroups) {
  const expected = new Set(expectedSymbols);
  const merged = new Map();
  for (const quotes of quoteGroups) {
    for (const quote of Array.isArray(quotes) ? quotes : []) {
      const symbol = String(quote?.symbol || '').trim();
      if (!expected.has(symbol)) continue;
      const existing = merged.get(symbol);
      if (!existing || quoteTimestamp(quote) >= quoteTimestamp(existing)) merged.set(symbol, quote);
    }
  }
  return expectedSymbols.map((symbol) => merged.get(symbol)).filter(Boolean);
}

async function loadPartialCaptureSeeds({ root, seedPaths, market, scheduledAt, producerId, expectedSymbols }) {
  const partialRoot = path.resolve(root, 'data', 'partial');
  const snapshots = [];
  for (const seedPath of normalizeSeedPaths(seedPaths)) {
    const target = path.resolve(root, seedPath);
    if (!isWithinDirectory(partialRoot, target)) {
      throw new Error(`Partial capture seed is outside data/partial: ${seedPath}`);
    }
    const snapshot = JSON.parse(await readFile(target, 'utf8'));
    const seedProducerId = String(snapshot?.producer?.id || '').trim();
    if (snapshot?.market !== market || snapshot?.scheduledAt !== scheduledAt
      || snapshot?.publishable === true || !Array.isArray(snapshot?.quotes)
      || (producerId && seedProducerId !== producerId)) {
      throw new Error(`Partial capture seed does not match the requested market slot and producer: ${seedPath}`);
    }
    snapshots.push(snapshot);
  }
  return mergeQuotesBySymbol(expectedSymbols, ...snapshots.map((snapshot) => snapshot.quotes));
}

function buildMergedCaptureCoverage({ expectedSymbols, capturedSymbols, requiredSymbols, optionalSymbols, collection, provider, endpointType }) {
  const capturedSet = new Set(capturedSymbols);
  const notAttemptedSet = new Set(collection?.notAttemptedSymbols || []);
  const missingSymbols = expectedSymbols.filter((symbol) => !capturedSet.has(symbol));
  const notAttemptedSymbols = missingSymbols.filter((symbol) => notAttemptedSet.has(symbol));
  const failedSymbols = missingSymbols.filter((symbol) => !notAttemptedSet.has(symbol));
  const missingRequiredSymbols = requiredSymbols.filter((symbol) => !capturedSet.has(symbol));
  const complete = capturedSymbols.length === expectedSymbols.length;
  return buildQuoteCollectionSummary({
    provider,
    endpointType,
    requestedSymbols: expectedSymbols,
    requestedSymbolCount: expectedSymbols.length,
    capturedSymbols,
    capturedSymbolCount: capturedSymbols.length,
    failedSymbols,
    failedSymbolCount: failedSymbols.length,
    notAttemptedSymbols,
    notAttemptedSymbolCount: notAttemptedSymbols.length,
    attemptedSymbolCount: expectedSymbols.length - notAttemptedSymbols.length,
    requiredSymbols,
    optionalSymbols,
    missingRequiredSymbols,
    collectionStatus: complete ? 'complete' : 'partial',
    validationStatus: notAttemptedSymbols.length
      ? 'collection_interrupted'
      : missingRequiredSymbols.length ? 'missing_required_symbols' : complete ? 'valid' : 'incomplete_symbol_coverage',
    publishable: complete && missingRequiredSymbols.length === 0,
    complete
  });
}

export { buildMergedCaptureCoverage, loadPartialCaptureSeeds, mergeQuotesBySymbol, normalizeSeedPaths };
