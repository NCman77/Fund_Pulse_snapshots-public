const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function toMinutes(time) {
  const [hour, minute] = String(time || '').split(':').map(Number);
  return hour * 60 + minute;
}

function formatLocalClock(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}:${values.second}`,
    minutes: Number(values.hour) * 60 + Number(values.minute) + Number(values.second) / 60
  };
}

function normalizeSlots(value) {
  const slots = (Array.isArray(value) ? value : String(value || '').split(','))
    .map((slot) => String(slot).trim())
    .filter(Boolean);
  if (!slots.length || slots.some((slot) => !TIME_PATTERN.test(slot))) {
    throw new Error('Session watcher requires one or more HH:mm capture slots.');
  }
  return [...new Set(slots)].sort((left, right) => toMinutes(left) - toMinutes(right));
}

function resolveSessions(config, localDate) {
  const configured = config?.calendar?.specialSessions?.[localDate] ?? config?.sessions?.regular;
  const sessions = Array.isArray(configured) ? configured : [configured];
  if (!sessions.length || sessions.some((session) => !TIME_PATTERN.test(session?.open) || !TIME_PATTERN.test(session?.close))) {
    throw new Error('Market configuration has an invalid trading session.');
  }
  return sessions;
}

function isSlotInSession(slot, sessions) {
  const minute = toMinutes(slot);
  return sessions.some((session) => minute >= toMinutes(session.open) && minute <= toMinutes(session.close));
}

function isMarketTradingDay(config, localDate, weekday) {
  return !['Sat', 'Sun'].includes(weekday) && !config?.calendar?.closedDates?.includes(localDate);
}

function buildSessionWatchPlan(config, slots, now = new Date()) {
  if (!config?.timezone) throw new Error('Market configuration requires an IANA timezone.');
  const local = formatLocalClock(now, config.timezone);
  const normalizedSlots = normalizeSlots(slots);
  const sessions = resolveSessions(config, local.date);
  const activeSlots = normalizedSlots.filter((slot) => isSlotInSession(slot, sessions));
  const skippedSlots = normalizedSlots.filter((slot) => !isSlotInSession(slot, sessions));
  return {
    market: config.market,
    timezone: config.timezone,
    localDate: local.date,
    isTradingDay: isMarketTradingDay(config, local.date, new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, weekday: 'short' }).format(now)),
    slots: activeSlots,
    skippedSlots,
    sessions
  };
}

function localSlotToUtc(localDate, slot, timezone, referenceDate = new Date()) {
  const [year, month, day] = localDate.split('-').map(Number);
  const [hour, minute] = slot.split(':').map(Number);
  const localClock = formatLocalClock(referenceDate, timezone);
  const [localHour, localMinute, localSecond] = localClock.time.split(':').map(Number);
  const localAsUtc = Date.UTC(year, month - 1, day, localHour, localMinute, localSecond);
  const offsetMs = localAsUtc - referenceDate.getTime();
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0) - offsetMs);
}

export { buildSessionWatchPlan, formatLocalClock, isMarketTradingDay, localSlotToUtc, normalizeSlots };
