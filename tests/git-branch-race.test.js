import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function git(cwd, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return result;
}

async function writeJson(root, relativePath, value) {
  const target = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function configureAuthor(repository) {
  git(repository, ['config', 'user.name', 'Fund Pulse race test']);
  git(repository, ['config', 'user.email', 'race-test@example.invalid']);
}

function commitAll(repository, message) {
  git(repository, ['add', '--all']);
  git(repository, ['commit', '-m', message]);
}

async function createRepositories(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fund-pulse-git-race-'));
  t.after(async () => rm(root, { recursive: true, force: true }));

  const seed = path.join(root, 'seed');
  const remote = path.join(root, 'remote.git');
  await mkdir(seed);
  git(seed, ['init', '--initial-branch=main']);
  configureAuthor(seed);
  await writeFile(path.join(seed, 'README.md'), '# race fixture\n', 'utf8');
  commitAll(seed, 'seed repository');
  git(root, ['clone', '--bare', seed, remote]);

  async function clone(name) {
    const target = path.join(root, name);
    git(root, ['clone', '--branch', 'main', remote, target]);
    configureAuthor(target);
    return target;
  }

  return {
    root,
    remote,
    writer: await clone('writer'),
    racerOne: await clone('racer-one'),
    racerTwo: await clone('racer-two'),
    clone
  };
}

test('immutable writer survives two remote advances without losing any snapshot', async (t) => {
  const repositories = await createRepositories(t);

  await writeJson(repositories.writer, 'data/raw/asia/jp/primary/10-35.json', {
    market: 'jp',
    slot: '10:35'
  });
  commitAll(repositories.writer, 'capture jp 10:35');

  await writeJson(repositories.racerOne, 'data/raw/america/us/primary/09-05.json', {
    market: 'us',
    slot: '09:05'
  });
  commitAll(repositories.racerOne, 'capture us 09:05');
  git(repositories.racerOne, ['push', 'origin', 'HEAD:main']);

  const firstPush = git(repositories.writer, ['push', 'origin', 'HEAD:main'], { allowFailure: true });
  assert.notEqual(firstPush.status, 0, 'the first push should lose the initial branch race');
  git(repositories.writer, ['fetch', 'origin', 'main']);
  git(repositories.writer, ['merge', '--no-edit', 'origin/main']);

  git(repositories.racerTwo, ['fetch', 'origin', 'main']);
  git(repositories.racerTwo, ['reset', '--hard', 'origin/main']);
  await writeJson(repositories.racerTwo, 'data/raw/europe/uk/primary/14-30.json', {
    market: 'uk',
    slot: '14:30'
  });
  commitAll(repositories.racerTwo, 'capture uk 14:30');
  git(repositories.racerTwo, ['push', 'origin', 'HEAD:main']);

  const secondPush = git(repositories.writer, ['push', 'origin', 'HEAD:main'], { allowFailure: true });
  assert.notEqual(secondPush.status, 0, 'the push after the first merge should lose the second branch race');
  git(repositories.writer, ['fetch', 'origin', 'main']);
  git(repositories.writer, ['merge', '--no-edit', 'origin/main']);
  git(repositories.writer, ['push', 'origin', 'HEAD:main']);

  const audit = await repositories.clone('audit-immutable');
  const expectedPaths = [
    'data/raw/asia/jp/primary/10-35.json',
    'data/raw/america/us/primary/09-05.json',
    'data/raw/europe/uk/primary/14-30.json'
  ];
  for (const relativePath of expectedPaths) {
    const content = await readFile(path.join(audit, ...relativePath.split('/')), 'utf8');
    assert.ok(content.length > 0, `${relativePath} must remain reachable from main`);
  }
});

test('mutable publisher discards a stale commit and rebuilds from the latest main', async (t) => {
  const repositories = await createRepositories(t);

  await writeJson(repositories.writer, 'data/latest/jp.json', {
    source: 'stale-before-race'
  });
  commitAll(repositories.writer, 'publish stale jp latest');

  await writeJson(repositories.racerOne, 'data/raw/asia/jp/backup/10-35.json', {
    market: 'jp',
    producerRole: 'backup',
    slot: '10:35'
  });
  commitAll(repositories.racerOne, 'capture jp backup 10:35');
  git(repositories.racerOne, ['push', 'origin', 'HEAD:main']);

  const stalePush = git(repositories.writer, ['push', 'origin', 'HEAD:main'], { allowFailure: true });
  assert.notEqual(stalePush.status, 0, 'the stale mutable commit should lose the branch race');

  git(repositories.writer, ['fetch', 'origin', 'main']);
  git(repositories.writer, ['reset', '--hard', 'origin/main']);
  await writeJson(repositories.writer, 'data/latest/jp.json', {
    source: 'data/raw/asia/jp/backup/10-35.json',
    rebuiltAfterRace: true
  });
  commitAll(repositories.writer, 'publish rebuilt jp latest');
  git(repositories.writer, ['push', 'origin', 'HEAD:main']);

  const audit = await repositories.clone('audit-mutable');
  const latest = JSON.parse(await readFile(path.join(audit, 'data', 'latest', 'jp.json'), 'utf8'));
  assert.deepEqual(latest, {
    source: 'data/raw/asia/jp/backup/10-35.json',
    rebuiltAfterRace: true
  });
  assert.equal(
    git(audit, ['log', '--format=%s', '--all', '--grep=publish stale jp latest']).stdout.trim(),
    '',
    'the rejected stale mutable commit must not become reachable from remote main'
  );
});
