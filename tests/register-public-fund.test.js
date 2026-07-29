import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeRegistrationPayload, registerPublicFund } from '../src/cli/register-public-fund.js';

test('public registration accepts exactly the public fund ID and name', () => {
  assert.deepEqual(normalizeRegistrationPayload({ fundId: ' acdd04 ', name: ' 安聯台灣科技基金 ' }), {
    fundId: 'ACDD04',
    name: '安聯台灣科技基金'
  });
  assert.throws(
    () => normalizeRegistrationPayload({ fundId: 'ACDD04', name: '基金', privateValue: 'not allowed' }),
    /may contain only fundId and name/
  );
});

test('public registration adds a new fund without changing an existing fund', async (t) => {
  const root = path.join(os.tmpdir(), `fund-pulse-public-registration-${process.pid}-${Date.now()}`);
  const catalogPath = path.join(root, 'config', 'public-funds', 'approved-funds.json');
  await mkdir(path.dirname(catalogPath), { recursive: true });
  await writeFile(catalogPath, `${JSON.stringify({ policy: 'public only', funds: [{ fundId: 'ACDD04', name: '既有名稱' }] })}\n`, 'utf8');
  t.after(() => rm(root, { recursive: true, force: true }));

  const added = await registerPublicFund(root, { fundId: 'NEW01', name: '新公開基金' });
  const duplicate = await registerPublicFund(root, { fundId: 'ACDD04', name: '不應覆寫' });
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));

  assert.equal(added.added, true);
  assert.equal(duplicate.added, false);
  assert.deepEqual(catalog.funds, [
    { fundId: 'ACDD04', name: '既有名稱' },
    { fundId: 'NEW01', name: '新公開基金' }
  ]);
});
