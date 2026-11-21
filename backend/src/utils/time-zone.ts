export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const DAY_MS = 86_400_000;

const zonedFormatters = new Map<string, Intl.DateTimeFormat>();

function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = zonedFormatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const canonical = formatter.resolvedOptions().timeZone;
  const existing = zonedFormatters.get(canonical);
  if (existing) return existing;
  zonedFormatters.set(canonical, formatter);
  return formatter;
}

export function cachedTimeZoneCount(): number {
  return zonedFormatters.size;
}

export function zonedParts(instant: Date, timeZone: string): Record<string, number> {
  const parts = zonedFormatter(timeZone).formatToParts(instant);
  return Object.fromEntries(parts.map((p) => [p.type, Number(p.value)]));
}

export function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const p = zonedParts(new Date(instantMs), timeZone);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

export function calendarDayIn(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function zonedMidnight(
  year: number,
  monthIndex: number,
  day: number,
  timeZone: string
): Date {
  const wall = Date.UTC(year, monthIndex, day);
  const guess = wall - zoneOffsetMs(wall, timeZone);
  const exact = [guess - DAY_MS, guess, guess + DAY_MS]
    .map((probe) => wall - zoneOffsetMs(probe, timeZone))
    .filter((candidate) => wall - zoneOffsetMs(candidate, timeZone) === candidate);
  if (exact.length > 0) return new Date(Math.min(...exact));
  const settled = new Date(wall - zoneOffsetMs(guess, timeZone));
  const requestedDay = new Date(wall).toISOString().slice(0, 10);
  return calendarDayIn(settled, timeZone) === requestedDay ? settled : new Date(guess);
}

export function zonedDayWindow(instant: Date, timeZone: string): { dayStart: Date; nextDay: Date } {
  const p = zonedParts(instant, timeZone);
  return {
    dayStart: zonedMidnight(p.year, p.month - 1, p.day, timeZone),
    nextDay: zonedMidnight(p.year, p.month - 1, p.day + 1, timeZone),
  };
}
