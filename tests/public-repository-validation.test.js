import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const validator = path.resolve('src', 'cli', 'validate-public-repository.js');

test('rejects raw-response diagnostic fields from persisted public data', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'public-validation-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  await mkdir(path.join(root, 'data'), { recursive: true });
  const target = path.join(root, 'data', 'status.json');

  await writeFile(target, JSON.stringify({ status: 'clean', responseDiagnostic: { timestampType: 'undefined' } }));
  const clean = await execFileAsync(process.execPath, [validator], { cwd: root });
  assert.match(clean.stdout, /Public repository validation passed/);

  await writeFile(target, JSON.stringify({ status: 'unsafe', responseDiagnostic: { responsePreview: 'raw payload' } }));
  await assert.rejects(
    execFileAsync(process.execPath, [validator], { cwd: root }),
    (error) => /prohibited raw-response diagnostic field/.test(String(error.stderr || error.message))
  );
});
