import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function workflow(name) {
  return readFile(path.join(root, '.github', 'workflows', name), 'utf8');
}

test('market latest and aggregate health have one workflow writer each', async () => {
  const [watcher, manualMarkets, manualTaiwan, latestPublisher, healthPublisher] = await Promise.all([
    workflow('run-market-session-watcher.yml'),
    workflow('capture-public-markets.yml'),
    workflow('capture-tw.yml'),
    workflow('publish-market-latest.yml'),
    workflow('publish-market-health.yml')
  ]);

  [watcher, manualMarkets, manualTaiwan].forEach((content) => {
    assert.doesNotMatch(content, /git add[^\n]*data\/latest\//);
    assert.doesNotMatch(content, /git add[^\n]*market-health\.json/);
    assert.doesNotMatch(content, /git pull --rebase|git rebase --abort/);
  });
  assert.match(latestPublisher, /git add -- "data\/latest\/\$MARKET\.json" "data\/status\/markets\/\$MARKET\.json"/);
  assert.match(healthPublisher, /git add -- data\/status\/market-health\.json/);
  assert.match(watcher, /gh workflow run publish-market-latest\.yml -f market="\$MARKET"/);
  assert.match(manualMarkets, /gh workflow run publish-market-latest\.yml/);
  assert.match(manualTaiwan, /gh workflow run publish-market-latest\.yml -f market=tw/);
});

test('workflows that share mutable documents have an explicit concurrency owner', async () => {
  const [manifest, registration, disclosures] = await Promise.all([
    workflow('build-taipei-1255-decision-manifest.yml'),
    workflow('register-public-fund.yml'),
    workflow('capture-public-fund-disclosures.yml')
  ]);
  assert.match(manifest, /group: taipei-1255-decision-manifest/);
  assert.match(registration, /group: public-fund-registration/);
  assert.doesNotMatch(registration, /public-fund-registration-\$\{\{/);
  assert.match(disclosures, /group: public-fund-disclosures/);
});

test('every reusable market watcher caller grants the publisher-dispatch permission', async () => {
  const callers = await Promise.all([
    'capture-international-market-sessions.yml',
    'capture-tw-session.yml',
    'capture-tw-1255-backup.yml',
    'capture-international-1255-backup.yml',
    'capture-international-tail-handoff.yml'
  ].map(workflow));

  callers.forEach((content) => {
    assert.match(content, /uses: \.\/\.github\/workflows\/run-market-session-watcher\.yml/);
    assert.match(content, /permissions:\s*\n\s*contents: write\s*\n\s*actions: write/);
  });
});

test('session watchers survive transient branch races and retry immutable pushes', async () => {
  const watcher = await workflow('run-market-session-watcher.yml');

  assert.match(watcher, /for push_attempt in 1 2 3 4 5 6; do/);
  assert.match(watcher, /git fetch origin main[\s\S]*?git merge --no-edit origin\/main[\s\S]*?git push origin HEAD:main/);
  assert.match(watcher, /while kill -0 "\$watcher_pid"[\s\S]*?if ! commit_snapshots; then[\s\S]*?checkpoint persistence deferred/);
  assert.doesNotMatch(watcher, /while kill -0 "\$watcher_pid"[\s\S]*?commit_snapshots \|\| exit 1[\s\S]*?done/);
  assert.match(watcher, /if ! commit_snapshots; then[\s\S]*?final capture flush failed[\s\S]*?exit 1/);
});

test('manual immutable capture workflows survive repeated branch advances', async () => {
  const captures = await Promise.all([
    workflow('capture-public-markets.yml'),
    workflow('capture-tw.yml')
  ]);

  captures.forEach((content) => {
    assert.match(content, /for push_attempt in 1 2 3 4 5 6; do/);
    assert.match(content, /git fetch origin main[\s\S]*?git merge --no-edit origin\/main[\s\S]*?git push origin HEAD:main/);
    assert.match(content, /Unable to persist immutable raw snapshots after bounded retries/);
    assert.doesNotMatch(content, /if ! git push origin HEAD:main; then/);
  });
});

test('every public main writer uses a six-attempt bounded push loop', async () => {
  const workflowsDir = path.join(root, '.github', 'workflows');
  const names = (await readdir(workflowsDir)).filter((name) => name.endsWith('.yml'));
  const entries = await Promise.all(names.map(async (name) => [name, await workflow(name)]));
  const writers = entries.filter(([, content]) => /git push origin HEAD:main/.test(content));

  assert.ok(writers.length > 0, 'expected at least one public main writer');
  writers.forEach(([name, content]) => {
    assert.match(
      content,
      /for (?:push_)?attempt in 1 2 3 4 5 6; do/,
      `${name} must tolerate repeated remote branch advances`
    );
  });
});
