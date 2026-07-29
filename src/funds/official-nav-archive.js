import path from 'node:path';
import { writeJsonAtomically } from '../storage/snapshot-writer.js';

function buildOfficialNavArchive(disclosure, sourceRawPath = '') {
  const fundId = String(disclosure?.fundId || '').trim().toUpperCase();
  const nav = disclosure?.nav || {};
  if (!fundId || !nav?.date || !Number.isFinite(Number(nav.value))) return null;

  return {
    schemaVersion: '1.0',
    fundId,
    fundName: String(disclosure?.fundName || fundId),
    officialNav: {
      date: nav.date,
      value: Number(nav.value),
      changeAmount: Number.isFinite(Number(nav.changeAmount)) ? Number(nav.changeAmount) : null
    },
    publishedAt: disclosure.capturedAt,
    source: disclosure.source,
    sourceRawPath
  };
}

async function archiveOfficialNav(root, disclosure, sourceRawPath = '') {
  const archive = buildOfficialNavArchive(disclosure, sourceRawPath);
  if (!archive) return null;
  const target = path.join(root, 'data', 'funds', 'nav', archive.fundId, `${archive.officialNav.date}.json`);
  await writeJsonAtomically(target, archive);
  return target;
}

export { archiveOfficialNav, buildOfficialNavArchive };
