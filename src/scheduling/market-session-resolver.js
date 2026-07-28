function localClock(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
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
  const time = Number(local.hour) * 60 + Number(local.minute);
  const sessions = config.sessions.regular;
  const ranges = Array.isArray(sessions) ? sessions : [sessions];
  return ranges.some((range) => time >= minutes(range.open) && time <= minutes(range.close)) ? 'regular' : 'closed';
}

