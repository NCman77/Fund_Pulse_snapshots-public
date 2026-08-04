import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSessionWatchPlan, localSlotToUtc, normalizeSlots } from '../scheduling/session-watch-plan.js';
import { buildSessionCaptureReport } from '../scheduling/session-capture-report.js';
import { writeJsonAtomically } from '../storage/snapshot-writer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CAPTURE_SCRIPT = path.join(__dirname, 'capture-market.js');
const market = String(process.argv[2] || '').trim();
const slotsArgument = process.argv.find((argument) => argument.startsWith('--slots='));
const slots = slotsArgument ? slotsArgument.slice('--slots='.length) : process.env.CAPTURE_SLOTS;
const maxLateSeconds = Number(process.env.SESSION_WATCH_MAX_LATE_SECONDS || 120);
const maxCaptureAttempts = Math.max(1, Number(process.env.SESSION_SLOT_MAX_ATTEMPTS || 3));
const retryDelayMilliseconds = Math.max(0, Number(process.env.SESSION_SLOT_RETRY_DELAY_SECONDS || 15) * 1_000);
const sessionName = String(process.env.SESSION_NAME || 'default').trim() || 'default';
const producerId = String(process.env.CAPTURE_PRODUCER_ID || `primary-${sessionName}`).trim();
const producerRole = String(process.env.CAPTURE_PRODUCER_ROLE || 'primary').trim() === 'backup' ? 'backup' : 'primary';

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseCaptureOutput(output) {
  const lines = String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.reverse()) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && parsed.status) return parsed;
    } catch {
      // Capture scripts may emit regular diagnostics before their JSON result.
    }
  }
  return null;
}

async function runCapture({ scheduledAt, slot }) {
  return new Promise((resolve, reject) => {
    let output = '';
    let errorOutput = '';
    const child = spawn(process.execPath, [CAPTURE_SCRIPT, market], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CAPTURE_SCHEDULE_RULE: 'session-watcher',
        CAPTURE_SCHEDULED_AT: scheduledAt.toISOString(),
        CAPTURE_SLOT: slot,
        CAPTURE_PRODUCER_ID: producerId,
        CAPTURE_PRODUCER_ROLE: producerRole
      }
    });
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      errorOutput += text;
      process.stderr.write(text);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      const result = parseCaptureOutput(`${output}\n${errorOutput}`);
      if (code !== 0) {
        const error = new Error(`Capture failed for ${market} at ${scheduledAt.toISOString()}: ${result?.error || 'capture-process-failed'}`);
        error.captureResult = result;
        reject(error);
        return;
      }
      if (result?.status !== 'captured' || !result.path) {
        reject(new Error(`Capture did not persist ${market} at ${scheduledAt.toISOString()}${result?.reason ? `: ${result.reason}` : ''}`));
        return;
      }
      resolve(result);
    });
  });
}

async function captureSlotWithRetry({
  root,
  target,
  marketId = market,
  runCaptureFn = runCapture,
  maxAttempts = maxCaptureAttempts,
  retryDelayMs = retryDelayMilliseconds,
  sleepFn = sleep
}) {
  const approvedMaxAttempts = Math.max(1, Number(maxAttempts) || 1);
  const approvedRetryDelayMs = Math.max(0, Number(retryDelayMs) || 0);
  let lastError = null;
  let lastCollection = null;
  const diagnostics = [];
  for (let attempt = 1; attempt <= approvedMaxAttempts; attempt += 1) {
    try {
      const result = await runCaptureFn(target);
      lastCollection = result.collection || null;
      diagnostics.push(...(result.diagnostics || []).map((diagnostic) => ({ ...diagnostic, captureAttempt: attempt })));
      const snapshot = JSON.parse(await readFile(path.join(root, result.path), 'utf8'));
      return {
        slot: target.slot,
        scheduledAt: target.scheduledAt.toISOString(),
        status: 'captured',
        attempts: attempt,
        timingStatus: snapshot.timingStatus || 'unknown',
        captureDelaySeconds: snapshot.captureDelaySeconds ?? null,
        collection: lastCollection,
        diagnostics
      };
    } catch (error) {
      lastError = error;
      lastCollection = error.captureResult?.collection || lastCollection;
      diagnostics.push(...(error.captureResult?.diagnostics || []).map((diagnostic) => ({ ...diagnostic, captureAttempt: attempt })));
      console.error(JSON.stringify({
        market: marketId,
        status: 'slot-capture-failed',
        slot: target.slot,
        attempt,
        maxAttempts: approvedMaxAttempts,
        error: error.message
      }));
      if (attempt < approvedMaxAttempts && approvedRetryDelayMs > 0) {
        await sleepFn(approvedRetryDelayMs * attempt);
      }
    }
  }
  return {
    slot: target.slot,
    scheduledAt: target.scheduledAt.toISOString(),
    status: 'failed',
    attempts: approvedMaxAttempts,
    error: lastError?.message || 'Capture failed without an error message',
    collection: lastCollection,
    diagnostics
  };
}

async function main() {
  if (!/^[a-z]{2,8}$/.test(market)) {
    throw new Error('Usage: node src/cli/watch-market-session.js <market> --slots=HH:mm,HH:mm');
  }
  const root = process.cwd();
  const config = JSON.parse(await readFile(path.join(root, 'config', 'markets', `${market}.json`), 'utf8'));
  const plan = buildSessionWatchPlan(config, normalizeSlots(slots));
  if (!plan.isTradingDay) {
    console.log(JSON.stringify({ market, status: 'skipped', reason: 'market-closed', localDate: plan.localDate }));
    return;
  }
  const now = new Date();
  const pending = plan.slots.map((slot) => ({
    slot,
    scheduledAt: localSlotToUtc(plan.localDate, slot, plan.timezone, now)
  }));

  console.log(JSON.stringify({
    market,
    status: plan.slots.length ? 'watching' : 'skipped',
    reason: plan.slots.length ? undefined : 'no-configured-slots-in-session',
    localDate: plan.localDate,
    slots: plan.slots,
    skippedSlots: plan.skippedSlots
  }));
  const results = [];
  for (const target of pending) {
    const delayMs = target.scheduledAt.getTime() - Date.now();
    if (delayMs > 0) await sleep(delayMs);

    const lagSeconds = Math.round((Date.now() - target.scheduledAt.getTime()) / 1_000);
    if (lagSeconds > maxLateSeconds) {
      console.error(JSON.stringify({ market, status: 'late-start', slot: target.slot, lagSeconds }));
      const result = {
        slot: target.slot,
        scheduledAt: target.scheduledAt.toISOString(),
        status: 'missed',
        attempts: 0,
        timingStatus: 'missed',
        captureDelaySeconds: lagSeconds,
        error: `Watcher started ${lagSeconds}s after the approved ${maxLateSeconds}s capture tolerance; no late replacement was written.`
      };
      results.push(result);
      console.log(JSON.stringify({ market, status: 'slot-finished', ...result }));
      continue;
    }
    const result = await captureSlotWithRetry({ root, target });
    results.push(result);
    console.log(JSON.stringify({ market, status: 'slot-finished', ...result }));
  }

  const report = {
    ...buildSessionCaptureReport({ market, sessionName, plan, results }),
    producer: { id: producerId, role: producerRole }
  };
  const reportPath = path.join(root, 'data', 'status', 'sessions', market, `${plan.localDate}-${sessionName}.json`);
  await writeJsonAtomically(reportPath, report);
  console.log(JSON.stringify({ market, status: report.summary.healthy ? 'session-healthy' : 'session-unhealthy', reportPath: path.relative(root, reportPath), summary: report.summary }));
  if (!report.summary.healthy) process.exitCode = 1;
}

const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;
if (isDirectRun) await main();

export { captureSlotWithRetry, main, parseCaptureOutput };
