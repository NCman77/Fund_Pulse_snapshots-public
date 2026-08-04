import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function timestamp(value) {
  const parsed = new Date(value || '').getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function isQualifiedMarketEntry(entry) {
  if (!entry?.path) return false;
  return entry.marketStateAtDecision === 'regular'
    ? entry.status === 'decision_window_capture'
    : entry.status === 'latest_available_before_decision' || entry.status === 'decision_window_capture';
}

function normalizeHoldingDependencies(fund) {
  const dependencies = (fund?.holdings || [])
    .filter((holding) => holding?.status === 'mapped' && holding?.symbol && holding?.market)
    .map((holding) => ({
      type: 'holding',
      symbol: String(holding.symbol),
      market: String(holding.market).toLowerCase(),
      currency: String(holding.currency || ''),
      weightPercent: Number(holding.weightPercent) || 0
    }));
  const merged = new Map();
  for (const dependency of dependencies) {
    const key = `${dependency.market}:${dependency.symbol}`;
    const existing = merged.get(key);
    merged.set(key, existing
      ? { ...existing, weightPercent: existing.weightPercent + dependency.weightPercent }
      : dependency);
  }
  return Array.from(merged.values())
    .sort((left, right) => `${left.market}:${left.symbol}`.localeCompare(`${right.market}:${right.symbol}`));
}

function normalizeFxDependencies(holdingDependencies, policy) {
  const currencies = Array.from(new Set(holdingDependencies.map(({ currency }) => currency).filter(Boolean))).sort();
  const symbols = currencies.flatMap((currency) => policy.currencyQuoteSymbols?.[currency] || []);
  return Array.from(new Set(symbols)).sort().map((symbol) => ({ type: 'fx', symbol }));
}

function dependencyFingerprint({ fund, holdingDependencies, fxDependencies, mappingVersion, policyVersion }) {
  return sha256({
    fundId: fund.fundId,
    holdingsDisclosureDate: fund.holdingsDisclosureDate,
    disclosureCapturedAt: fund.capturedAt,
    mappingVersion,
    policyVersion,
    dependencies: [...holdingDependencies, ...fxDependencies]
  });
}

async function loadQualifiedQuotes(root, marketEntries, cutoffMs) {
  const byMarket = new Map();
  const fx = new Map();
  for (const entry of marketEntries.filter(isQualifiedMarketEntry)) {
    const snapshot = JSON.parse(await readFile(path.join(root, ...String(entry.path).split('/')), 'utf8'));
    const marketQuotes = new Map();
    for (const quote of snapshot?.quotes || []) {
      const symbol = String(quote?.symbol || '').trim();
      const quoteAtMs = timestamp(quote?.quoteAt);
      if (!symbol || quoteAtMs === null || quoteAtMs > cutoffMs) continue;
      const normalized = { symbol, quoteAt: new Date(quoteAtMs).toISOString(), sourcePath: entry.path };
      const existing = marketQuotes.get(symbol);
      if (!existing || existing.quoteAt < normalized.quoteAt) marketQuotes.set(symbol, normalized);
      const existingFx = fx.get(symbol);
      if (!existingFx || existingFx.quoteAt < normalized.quoteAt) fx.set(symbol, normalized);
    }
    byMarket.set(entry.market, marketQuotes);
  }
  return { byMarket, fx };
}

function missingDependency(dependency, quoteIndex) {
  const quote = dependency.type === 'holding'
    ? quoteIndex.byMarket.get(dependency.market)?.get(dependency.symbol)
    : quoteIndex.fx.get(dependency.symbol);
  return quote ? null : { ...dependency, reason: 'qualified_quote_missing' };
}

async function buildFundDecisionCoverage({ root, decisionAt, decisionWindowEndsAt, marketEntries, holdingCoverage, policy }) {
  const decisionMs = timestamp(decisionAt);
  const cutoffMs = timestamp(decisionWindowEndsAt);
  if (decisionMs === null || cutoffMs === null || cutoffMs < decisionMs) {
    throw new Error('Fund decision coverage requires a valid decision window.');
  }
  const coverageGeneratedMs = timestamp(holdingCoverage?.generatedAt);
  const coverageAsOfDecision = decisionMs !== null && coverageGeneratedMs !== null && coverageGeneratedMs <= decisionMs;
  const quoteIndex = await loadQualifiedQuotes(root, marketEntries, cutoffMs);
  const funds = [];

  for (const fund of holdingCoverage?.funds || []) {
    const holdingDependencies = normalizeHoldingDependencies(fund);
    const fxDependencies = normalizeFxDependencies(holdingDependencies, policy);
    const dependencies = [...holdingDependencies, ...fxDependencies];
    const missingDependencies = dependencies.map((dependency) => missingDependency(dependency, quoteIndex)).filter(Boolean);
    const unmappedHoldingNames = (fund?.holdings || [])
      .filter((holding) => holding?.status !== 'mapped')
      .map((holding) => String(holding?.name || '').trim())
      .filter(Boolean)
      .sort();
    const availableHoldingWeightPercent = holdingDependencies
      .filter((dependency) => !missingDependencies.some((missing) => (
        missing.type === 'holding' && missing.market === dependency.market && missing.symbol === dependency.symbol
      )))
      .reduce((total, dependency) => total + dependency.weightPercent, 0);
    const statusReasons = [];
    if (!coverageAsOfDecision) statusReasons.push('holding_coverage_not_available_as_of_decision');
    if (fund.status !== 'processed') statusReasons.push('fund_disclosure_not_processed');
    if (!holdingDependencies.length) statusReasons.push('no_mapped_holding_dependencies');
    if (unmappedHoldingNames.length) statusReasons.push('unmapped_disclosed_holdings');
    if (missingDependencies.length) statusReasons.push('missing_qualified_dependencies');
    funds.push({
      fundId: fund.fundId,
      fundName: fund.fundName,
      status: statusReasons.length ? 'incomplete' : 'complete',
      eligible: statusReasons.length === 0,
      scope: 'disclosed_holdings_only',
      statusReasons,
      holdingsDisclosureDate: fund.holdingsDisclosureDate || null,
      disclosureCapturedAt: fund.capturedAt || null,
      dependencyFingerprint: dependencyFingerprint({
        fund, holdingDependencies, fxDependencies,
        mappingVersion: holdingCoverage.mappingVersion,
        policyVersion: policy.version
      }),
      dependencyCount: dependencies.length,
      mappedHoldingCount: holdingDependencies.length,
      unmappedHoldingCount: unmappedHoldingNames.length,
      mappedHoldingWeightPercent: Number(fund.mappedWeightPercent || 0),
      availableHoldingWeightPercent: Number(availableHoldingWeightPercent.toFixed(4)),
      unmappedHoldingNames,
      dependencies,
      missingDependencies
    });
  }

  return {
    schemaVersion: '1.0',
    mode: policy.mode || 'shadow_only',
    scope: 'disclosed_holdings_only',
    policyVersion: policy.version,
    mappingVersion: holdingCoverage?.mappingVersion ?? null,
    sourceCoverageGeneratedAt: holdingCoverage?.generatedAt || '',
    coverageAsOfDecision,
    fundCount: funds.length,
    eligibleFundCount: funds.filter(({ eligible }) => eligible).length,
    funds
  };
}

export { buildFundDecisionCoverage, isQualifiedMarketEntry, normalizeHoldingDependencies };
