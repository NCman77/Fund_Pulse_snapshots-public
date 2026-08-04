import { buildTaipeiDecisionManifest, taipeiDate } from './build-taipei-decision-manifest.js';

const DEFAULT_SLOTS = ['09:05', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '12:55', '13:00', '13:25', '13:30'];
const requestedDate = process.argv.find((arg) => arg.startsWith('--date='))?.slice('--date='.length) || taipeiDate();
const requestedSlots = process.argv.find((arg) => arg.startsWith('--slots='))?.slice('--slots='.length);
const slots = requestedSlots ? requestedSlots.split(',').map((slot) => slot.trim()).filter(Boolean) : DEFAULT_SLOTS;

const results = [];
for (const slot of Array.from(new Set(slots))) {
  const result = await buildTaipeiDecisionManifest(process.cwd(), { date: requestedDate, slot });
  results.push({ slot, path: result.target, timingWithinTolerance: result.manifest.timingWithinTolerance, eligibleFundCount: result.manifest.fundCoverage?.eligibleFundCount || 0 });
}
console.log(JSON.stringify({ status: 'built', date: requestedDate, results }));

export { DEFAULT_SLOTS };
