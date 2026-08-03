import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
    const slots = body.match(/slots:\s*'([^']+)'/)?.[1];
    const scheduledCron = body.match(/github\.event\.schedule == '([^']+)'/)?.[1];
    return market && slots ? {
      workflow,
      job,
      market,
      slots: slots.split(',').map((slot) => slot.trim()),
      scheduledCron
    } : null;
  }).filter(Boolean);
}

test('scheduled market slots have one owner and a four-hour runner lead', async () => {
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
  }
  assert.equal(owners.size, 116, 'all reviewed market slots must remain assigned exactly once');
});
