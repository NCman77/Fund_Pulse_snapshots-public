import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('public long watcher dispatches only bounded private finalization inputs', async () => {
  const source = await readFile(
    path.join(root, '.github', 'workflows', 'trigger-private-taiwan-finalization.yml'),
    'utf8'
  );

  assert.match(source, /timeout-minutes: 360/);
  assert.match(source, /15:15.*16:00.*17:20.*18:20.*20:10.*20:25.*20:45.*21:00/);
  assert.match(source, /PRIVATE_REPO_ACTIONS_TOKEN: \$\{\{ secrets\.PRIVATE_REPO_ACTIONS_TOKEN \}\}/);
  assert.match(source, /repos\/NCman77\/Fund_Pulse\/actions\/workflows\/finalize-taiwan-daily-results\.yml\/dispatches/);
  assert.match(source, /inputs: \{business_date: \$business_date, attempt_slot: \$attempt_slot, final_attempt: \$final_attempt\}/);
  assert.match(source, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(source, /contents: write|actions: write/);
  assert.doesNotMatch(source, /npm run|server\/|international-funds\/|model/i);
  assert.match(source, /Failed to trigger the private Taiwan finalizer[\s\S]*?return 1/);
});
