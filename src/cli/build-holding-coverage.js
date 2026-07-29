import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildHoldingSymbolIndex, resolveHoldingSymbol } from '../holdings/holding-symbol-mapper.js';
import { writeJsonAtomically } from '../storage/snapshot-writer.js';

const root = process.cwd();
const catalog = JSON.parse(await readFile(path.join(root, 'config', 'public-funds', 'approved-funds.json'), 'utf8'));
const mappings = JSON.parse(await readFile(path.join(root, 'config', 'public-holdings', 'approved-holding-symbols.json'), 'utf8'));
const index = buildHoldingSymbolIndex(mappings.mappings);
const latestDirectory = path.join(root, 'data', 'funds', 'latest');
const latestFiles = new Set((await readdir(latestDirectory)).filter((name) => name.endsWith('.json')));
const generatedAt = new Date().toISOString();

const funds = [];
for (const fund of catalog.funds ?? []) {
  const fileName = `${fund.fundId}.json`;
  if (!latestFiles.has(fileName)) {
    funds.push({ fundId: fund.fundId, fundName: fund.name, status: 'awaiting_disclosure' });
    continue;
  }
  const disclosure = JSON.parse(await readFile(path.join(latestDirectory, fileName), 'utf8'));
  const holdings = (disclosure.holdingsDisclosure?.holdings ?? []).map((holding) => {
    const mapped = resolveHoldingSymbol(holding.name, index);
    return {
      name: holding.name,
      weightPercent: holding.weightPercent,
      status: mapped ? 'mapped' : 'unmapped',
      ...(mapped || {})
    };
  });
  const mapped = holdings.filter((holding) => holding.status === 'mapped');
  const unmapped = holdings.filter((holding) => holding.status === 'unmapped');
  const mappedWeightPercent = mapped.reduce((total, holding) => total + (Number(holding.weightPercent) || 0), 0);
  funds.push({
    fundId: fund.fundId,
    fundName: disclosure.fundName || fund.name,
    status: 'processed',
    capturedAt: disclosure.capturedAt,
    holdingsDisclosureDate: disclosure.holdingsDisclosure?.date || null,
    mappedHoldingCount: mapped.length,
    unmappedHoldingCount: unmapped.length,
    mappedWeightPercent: Number(mappedWeightPercent.toFixed(4)),
    holdings
  });
}

const processed = funds.filter((fund) => fund.status === 'processed');
const unmappedNames = Array.from(new Set(processed.flatMap((fund) => fund.holdings.filter((holding) => holding.status === 'unmapped').map((holding) => holding.name)))).sort();
const coverage = {
  schemaVersion: '1.0',
  generatedAt,
  mappingVersion: mappings.version,
  fundCount: funds.length,
  processedFundCount: processed.length,
  funds
};
const health = {
  generatedAt,
  mappingVersion: mappings.version,
  approvedMappingCount: index.size,
  processedFundCount: processed.length,
  unresolvedHoldingCount: unmappedNames.length,
  unresolvedHoldingNames: unmappedNames
};
await writeJsonAtomically(path.join(root, 'data', 'funds', 'coverage', 'latest.json'), coverage);
await writeJsonAtomically(path.join(root, 'data', 'status', 'holding-mapping-health.json'), health);
console.log(JSON.stringify({ status: 'built', processedFundCount: processed.length, unresolvedHoldingCount: unmappedNames.length }));
