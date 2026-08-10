import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const prohibitedNames = /(^|[\\/])(runtime|logs|credentials)([\\/]|$)|\.(pem|key|sqlite|sqlite3|db)$/i;
const prohibitedContent = /(github_pat_|ghp_|xox[baprs]-|BEGIN (RSA |OPENSSH )?PRIVATE KEY|password\s*[:=]|api[_-]?key\s*[:=]|cookie\s*[:=])/i;
const privateModelField = /(model|prediction|recommend|calibration|training|ensemble|confidence|private|feature|valuation)/i;
const prohibitedPersistedDiagnosticField = /^(responsePreview|responseBody|requestUrl|contentType)$/i;

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

function findPrivateModelFields(value, currentPath = '$') {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findPrivateModelFields(item, `${currentPath}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];

  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = `${currentPath}.${key}`;
    const keyViolation = privateModelField.test(key) ? [`${childPath}: prohibited private-model field`] : [];
    const diagnosticViolation = prohibitedPersistedDiagnosticField.test(key)
      ? [`${childPath}: prohibited raw-response diagnostic field`]
      : [];
    return [...keyViolation, ...diagnosticViolation, ...findPrivateModelFields(child, childPath)];
  });
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
  if ((relative.startsWith(`data${path.sep}`) || relative.startsWith(`config${path.sep}`)) && /\.json$/i.test(relative)) {
    try {
      const payload = JSON.parse(await readFile(file, 'utf8'));
      violations.push(...findPrivateModelFields(payload).map((message) => `${relative}: ${message}`));
    } catch (error) {
      violations.push(`${relative}: invalid JSON (${error.message})`);
    }
  }
}

if (violations.length) throw new Error(`Public repository validation failed:\n${violations.join('\n')}`);
console.log('Public repository validation passed.');
