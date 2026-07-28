import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const prohibitedNames = /(^|[\\/])(runtime|logs|credentials)([\\/]|$)|\.(pem|key|sqlite|sqlite3|db)$/i;
const prohibitedContent = /(github_pat_|ghp_|xox[baprs]-|BEGIN (RSA |OPENSSH )?PRIVATE KEY|password\s*[:=]|api[_-]?key\s*[:=]|cookie\s*[:=])/i;

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

const violations = [];
for (const file of await walk(root)) {
  const relative = path.relative(root, file);
  if (prohibitedNames.test(relative)) violations.push(`${relative}: prohibited filename`);
  // The detector's own regular expression contains credential-shaped text.
  if (relative.split(path.sep).join('/') === 'src/cli/validate-public-repository.js') continue;
  if ((await stat(file)).size <= 1_000_000 && /\.(js|json|md|ya?ml|txt|env)$/i.test(file)) {
    const content = await readFile(file, 'utf8');
    if (prohibitedContent.test(content)) violations.push(`${relative}: possible secret or credential marker`);
  }
}

if (violations.length) throw new Error(`Public repository validation failed:\n${violations.join('\n')}`);
console.log('Public repository validation passed.');
