import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowFiles = [
  'capture-international-market-sessions.yml',
  'capture-tw-session.yml',
  'capture-tw-1255-backup.yml',
  'capture-international-1255-backup.yml'
];

function minutes(clock) {
  const [hour, minute] = clock.split(':').map(Number);
  return hour * 60 + minute;
}

function parseSchedules(source) {
  return [...source.matchAll(/- cron: '([^']+)'/g)].map((match) => match[1]);
}

function parseWatchJobs(source, workflow) {
  const jobsIndex = source.search(/\r?\njobs:\r?\n/);
  if (jobsIndex < 0) return [];
  const jobs = source.slice(jobsIndex);
  return [...jobs.matchAll(/^  ([a-z][\w-]*):\r?\n([\s\S]*?)(?=^  [a-z][\w-]*:\r?\n|(?![\s\S]))/gm)].map((match) => {
    const [, job, body] = match;
    const market = body.match(/market:\s*([a-z]{2,8})/)?.[1];
    const slotsMatch = body.match(/slots:\s*(?:'([^']+)'|([^\r\n}]+))/);
    const slots = String(slotsMatch?.[1] || slotsMatch?.[2] || '').trim();
    const sessionName = body.match(/session_name:\s*([a-z0-9-]+)/)?.[1];
    const scheduledCron = body.match(/github\.event\.schedule == '([^']+)'/)?.[1];
    return market && slots ? {
      workflow,
      job,
      market,
      sessionName,
      slots: slots.split(',').map((slot) => slot.trim()),
      scheduledCron
    } : null;
  }).filter(Boolean);
}

test('scheduled market slots have one owner and fit the watcher runtime budget', async () => {
  const workflows = await Promise.all(workflowFiles.map(async (workflow) => {
    const source = await readFile(path.join(root, '.github', 'workflows', workflow), 'utf8');
    const schedules = parseSchedules(source);
    return parseWatchJobs(source, workflow).map((job) => ({
      ...job,
      cron: job.scheduledCron || schedules.at(0)
    }));
  }));

  const owners = new Map();
  for (const job of workflows.flat()) {
    assert.ok(job.cron, `${job.workflow}:${job.job} must have a schedule`);
    const [minute, hour] = job.cron.split(' ').map(Number);
    for (const slot of job.slots) {
      const key = `${job.market}:${slot}`;
      assert.equal(owners.has(key), false, `${key} has duplicate owners: ${owners.get(key)}, ${job.workflow}:${job.job}`);
      owners.set(key, `${job.workflow}:${job.job}`);
    }
    assert.ok(
      minutes(job.slots[0]) - (hour * 60 + minute) >= 240,
      `${job.workflow}:${job.job} starts less than four hours before ${job.slots[0]}`
    );
    assert.ok(
      minutes(job.slots.at(-1)) - (hour * 60 + minute) <= 340,
      `${job.workflow}:${job.job} leaves less than twenty minutes before the six-hour watcher timeout`
    );
  }
  assert.equal(owners.size, 116, 'all reviewed market slots must remain assigned exactly once');
});

test('tail handoff overlaps only the reviewed UK and EU primary tail slots as a backup producer', async () => {
  const [primarySource, handoffSource, reusableSource] = await Promise.all([
    readFile(path.join(root, '.github', 'workflows', 'capture-international-market-sessions.yml'), 'utf8'),
    readFile(path.join(root, '.github', 'workflows', 'capture-international-tail-handoff.yml'), 'utf8'),
    readFile(path.join(root, '.github', 'workflows', 'run-market-session-watcher.yml'), 'utf8')
  ]);
  const primaryJobs = parseWatchJobs(primarySource, 'capture-international-market-sessions.yml');
  const handoffJobs = parseWatchJobs(handoffSource, 'capture-international-tail-handoff.yml');

  assert.equal(handoffJobs.length, 2, 'only UK and EU may have a tail handoff');
  for (const handoff of handoffJobs) {
    assert.match(handoff.sessionName, /-tail-handoff-backup$/, `${handoff.market} handoff must be classified as backup`);
    const primaryTail = primaryJobs
      .filter((job) => job.market === handoff.market && ['s4', 's5'].includes(job.sessionName))
      .flatMap((job) => job.slots);
    assert.deepEqual(handoff.slots, primaryTail, `${handoff.market} handoff must cover exactly the reviewed s4/s5 tail`);
  }

  assert.match(reusableSource, /CAPTURE_PRODUCER_ID: \$\{\{ inputs\.session_name \}\}/);
  assert.match(reusableSource, /CAPTURE_PRODUCER_ROLE: \$\{\{ contains\(inputs\.session_name, 'backup'\) && 'backup' \|\| 'primary' \}\}/);
  assert.match(reusableSource, /group: session-watch-\$\{\{ inputs\.market \}\}-\$\{\{ inputs\.session_name \}\}/);
  assert.match(reusableSource, /cancel-in-progress: false/);
});

test('each watcher concurrency identity has one fixed slot payload', async () => {
  const workflowsDirectory = path.join(root, '.github', 'workflows');
  const names = (await readdir(workflowsDirectory)).filter((name) => name.endsWith('.yml'));
  const sources = await Promise.all(names.map(async (name) => ({
    name,
    source: await readFile(path.join(workflowsDirectory, name), 'utf8')
  })));
  const callers = sources.filter(({ source }) => /uses: \.\/\.github\/workflows\/run-market-session-watcher\.yml/.test(source));
  const identities = new Map();

  for (const { name, source } of callers) {
    const jobs = parseWatchJobs(source, name);
    assert.ok(jobs.length > 0, `${name} must expose static watcher inputs for ownership validation`);
    for (const job of jobs) {
      assert.ok(job.sessionName, `${name}:${job.job} must have a fixed session_name`);
      const identity = `${job.market}:${job.sessionName}`;
      assert.equal(
        identities.has(identity),
        false,
        `${identity} would share a concurrency group across distinct caller payloads`
      );
      identities.set(identity, { workflow: name, slots: job.slots });
    }
  }

  assert.ok(identities.size > 0, 'expected reusable watcher caller identities');
});
