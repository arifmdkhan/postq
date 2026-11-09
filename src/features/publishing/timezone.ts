export function validTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 80) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(0); return true; } catch { return false; }
}

export function zonedMinute(timestamp: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(timestamp);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function zonedMinuteToUtc(value: unknown, timezone: string, now = -Infinity) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !validTimezone(timezone)) return null;
  const naive = Date.parse(value + ":00Z");
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 16) !== value) return null;
  const candidates = new Set<number>();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const sample = naive + hours * 3600000;
    const offset = Date.parse(zonedMinute(sample, timezone) + ":00Z") - sample;
    const candidate = naive - offset;
    if (zonedMinute(candidate, timezone) === value) candidates.add(candidate);
  }
  // Reject repeated and nonexistent wall times instead of silently choosing a DST offset.
  const times = [...candidates];
  return times.length === 1 && times[0] > now ? times[0] : null;
}

export function nextDate(day: string) { return new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10); }

export function zonedDayStart(day: string, timezone: string) {
  // Find the first real minute of a date, including zones that skip midnight or an entire date.
  const naive = Date.parse(day) / 60000;
  let low = naive - 36 * 60;
  let high = naive + 36 * 60;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (zonedMinute(middle * 60000, timezone).slice(0, 10) < day) low = middle + 1;
    else high = middle;
  }
  return low * 60000;
}
