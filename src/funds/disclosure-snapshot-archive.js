import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomically } from '../storage/snapshot-writer.js';

function buildDisclosureSnapshot(disclosure, holdingSymbolIndex) {
  const date = String(disclosure?.capturedAt || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !disclosure?.fundId) throw new Error('Public disclosure archive requires fund ID and capture date.');
  return {
    schemaVersion: '1.0',
    fundId: disclosure.fundId,
    fundName: disclosure.fundName || disclosure.fundId,
    capturedAt: disclosure.capturedAt,
    source: disclosure.source,
    nav: disclosure.nav,
    holdingsDisclosure: disclosure.holdingsDisclosure,
    approvedHoldingSymbols: (disclosure?.holdingsDisclosure?.holdings || []).map((holding) => ({
      name: holding.name,
      ...(holdingSymbolIndex.get(String(holding.name || '').trim()) || {})
    }))
  };
}

async function archiveDisclosureSnapshot(root, disclosure, holdingSymbolIndex) {
  const snapshot = buildDisclosureSnapshot(disclosure, holdingSymbolIndex);
  const date = snapshot.capturedAt.slice(0, 10);
  const target = path.join(root, 'data', 'funds', 'disclosures', snapshot.fundId, `${date}.json`);
  await writeJsonAtomically(target, snapshot);
  return target;
}

async function writeDisclosureManifest(root, date, archivePaths) {
  const snapshots = await Promise.all(archivePaths.sort().map(async (filePath) => {
    const content = await readFile(filePath);
    return {
      path: path.relative(root, filePath).split(path.sep).join('/'),
      sha256: createHash('sha256').update(content).digest('hex')
    };
  }));
  const target = path.join(root, 'data', 'funds', 'disclosures', 'manifests', date.slice(0, 4), `${date}.json`);
  await writeJsonAtomically(target, { schemaVersion: '1.0', date, generatedAt: new Date().toISOString(), snapshots });
  return target;
}

export { archiveDisclosureSnapshot, buildDisclosureSnapshot, writeDisclosureManifest };
