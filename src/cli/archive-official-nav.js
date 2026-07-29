import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { archiveOfficialNav } from '../funds/official-nav-archive.js';

const root = process.cwd();
const latestDirectory = path.join(root, 'data', 'funds', 'latest');
const entries = await readdir(latestDirectory, { withFileTypes: true });
let archivedCount = 0;

for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith('.json'))) {
  const disclosure = JSON.parse(await readFile(path.join(latestDirectory, entry.name), 'utf8'));
  const target = await archiveOfficialNav(root, disclosure);
  if (target) archivedCount += 1;
}

console.log(JSON.stringify({ status: 'archived', archivedCount }));
