import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomically } from './snapshot-writer.js';

async function walk(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(fullPath);
  }
  return files;
}

export async function buildDailyManifest(root, { market, region, date }) {
  const rawDirectory = path.join(root, 'data', 'raw', region, market, date.slice(0, 4), date);
  const rawFiles = await walk(rawDirectory);
  const snapshots = await Promise.all(rawFiles.map(async (file) => {
    const content = await readFile(file);
    const snapshot = JSON.parse(content);
    return {
      path: path.relative(root, file).split(path.sep).join('/'),
      capturedAt: snapshot.capturedAt,
      sha256: createHash('sha256').update(content).digest('hex')
    };
  }));
  if (!snapshots.length) return null;
  const manifest = { schemaVersion: '1.0', market, date, generatedAt: new Date().toISOString(), snapshots };
  const target = path.join(root, 'data', 'manifests', date.slice(0, 4), date, `${market}.json`);
  await writeJsonAtomically(target, manifest);
  return target;
}

