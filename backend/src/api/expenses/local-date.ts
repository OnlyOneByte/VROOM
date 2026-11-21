import { zonedParts, zoneOffsetMs } from '../../utils/time-zone';

export function buildLocalDate(
  year: number,
  month: number,
  day: number,
  hh = 0,
  mm = 0,
  ss = 0
): Date | null {
  const dt = new Date(year, month - 1, day, hh, mm, ss);
  if (Number.isNaN(dt.getTime())) return null;
  const echoes = dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day;
  return echoes ? dt : null;
}

export function buildZonedDate(
  year: number,
  month: number,
  day: number,
  timeZone: string,
  hh = 12,
  mm = 0,
  ss = 0
): Date | null {
  const wall = Date.UTC(year, month - 1, day, hh, mm, ss);
  if (Number.isNaN(wall)) return null;
  const guess = wall - zoneOffsetMs(wall, timeZone);
  const dt = new Date(wall - zoneOffsetMs(guess, timeZone));
  const p = zonedParts(dt, timeZone);
  return p.year === year && p.month === month && p.day === day ? dt : null;
}

export type ClockTime = [hours: number, minutes: number, seconds: number];

export function buildImportDate(
  year: number,
  month: number,
  day: number,
  timeZone?: string,
  time?: ClockTime
): Date | null {
  if (timeZone) {
    return time
      ? buildZonedDate(year, month, day, timeZone, ...time)
      : buildZonedDate(year, month, day, timeZone);
  }
  return time ? buildLocalDate(year, month, day, ...time) : buildCalendarDate(year, month, day);
}

export function buildCalendarDate(year: number, month: number, day: number): Date | null {
  const dt = new Date(Date.UTC(year, month - 1, day, 12));
  if (Number.isNaN(dt.getTime())) return null;
  const echoes =
    dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
  return echoes ? dt : null;
}
