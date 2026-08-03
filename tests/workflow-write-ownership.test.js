import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
