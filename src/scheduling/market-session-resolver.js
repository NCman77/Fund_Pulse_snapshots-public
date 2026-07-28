function localClock(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function minutes(value) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

export function resolveMarketSession(config, now = new Date()) {
  const local = localClock(now, config.timezone);
  if (['Sat', 'Sun'].includes(local.weekday)) return 'closed';
  const date = `${local.year}-${local.month}-${local.day}`;
  if (config.calendar?.closedDates?.includes(date)) return 'closed';
  const time = Number(local.hour) * 60 + Number(local.minute);
  const sessions = config.calendar?.specialSessions?.[date] ?? config.sessions.regular;
  const ranges = Array.isArray(sessions) ? sessions : [sessions];
  return ranges.some((range) => time >= minutes(range.open) && time <= minutes(range.close)) ? 'regular' : 'closed';
}

export function isMarketDayFinished(config, now = new Date()) {
  const local = localClock(now, config.timezone);
  if (['Sat', 'Sun'].includes(local.weekday)) return true;
  const date = `${local.year}-${local.month}-${local.day}`;
  if (config.calendar?.closedDates?.includes(date)) return true;
  const sessions = config.calendar?.specialSessions?.[date] ?? config.sessions.regular;
  const ranges = Array.isArray(sessions) ? sessions : [sessions];
  const finalClose = Math.max(...ranges.map((range) => minutes(range.close)));
  return Number(local.hour) * 60 + Number(local.minute) > finalClose;
}
