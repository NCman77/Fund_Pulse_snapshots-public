import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowsDir = path.join(root, '.github', 'workflows');

async function workflows() {
  const names = (await readdir(workflowsDir)).filter((name) => name.endsWith('.yml'));
  return Object.fromEntries(await Promise.all(names.map(async (name) => [
    name,
    await readFile(path.join(workflowsDir, name), 'utf8')
  ])));
}

function writePermissions(source) {
  const block = source.match(/^permissions:\r?\n((?: {2,}[^\r\n]*(?:\r?\n|$))*)/m)?.[1] ?? '';
  return new Set([...block.matchAll(/^ {2,}([\w-]+): write\s*$/gm)].map((match) => match[1]));
}

function localReusableCalls(source) {
  return [...source.matchAll(/^\s+uses:\s*\.\/\.github\/workflows\/([^\s]+\.yml)\s*$/gm)]
    .map((match) => match[1]);
}

test('workflow dispatchers and reusable callers meet their permission contracts', async () => {
  const files = await workflows();

  for (const [name, source] of Object.entries(files)) {
    const permissions = writePermissions(source);
    if (/\bgh\s+workflow\s+run\b/.test(source)) {
      assert.ok(permissions.has('actions'), `${name} dispatches a workflow and must grant actions: write`);
    }

    for (const calleeName of localReusableCalls(source)) {
      const callee = files[calleeName];
      assert.ok(callee, `${name} calls missing reusable workflow ${calleeName}`);
      for (const permission of writePermissions(callee)) {
        assert.ok(
          permissions.has(permission),
          `${name} calls ${calleeName}, which requires ${permission}: write`
        );
      }
    }
  }
});
