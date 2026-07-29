import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSessionWatchPlan, localSlotToUtc, normalizeSlots } from '../scheduling/session-watch-plan.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CAPTURE_SCRIPT = path.join(__dirname, 'capture-market.js');
const market = String(process.argv[2] || '').trim();
const slotsArgument = process.argv.find((argument) => argument.startsWith('--slots='));
const slots = slotsArgument ? slotsArgument.slice('--slots='.length) : process.env.CAPTURE_SLOTS;
const maxLateSeconds = Number(process.env.SESSION_WATCH_MAX_LATE_SECONDS || 120);

if (!/^[a-z]{2,8}$/.test(market)) {
  throw new Error('Usage: node src/cli/watch-market-session.js <market> --slots=HH:mm,HH:mm');
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runCapture({ scheduledAt }) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CAPTURE_SCRIPT, market], {
      stdio: 'inherit',
      env: {
        ...process.env,
        CAPTURE_SCHEDULE_RULE: 'session-watcher',
        CAPTURE_SCHEDULED_AT: scheduledAt.toISOString()
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Capture failed for ${market} at ${scheduledAt.toISOString()}`)));
  });
}

async function main() {
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
  for (const target of pending) {
    const delayMs = target.scheduledAt.getTime() - Date.now();
    if (delayMs > 0) await sleep(delayMs);

    const lagSeconds = Math.round((Date.now() - target.scheduledAt.getTime()) / 1_000);
    if (lagSeconds > maxLateSeconds) {
      console.error(JSON.stringify({ market, status: 'late-start', slot: target.slot, lagSeconds }));
    }
    await runCapture(target);
  }
}

await main();
