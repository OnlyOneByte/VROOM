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

export function buildCalendarDate(year: number, month: number, day: number): Date | null {
  const dt = new Date(Date.UTC(year, month - 1, day, 12));
  if (Number.isNaN(dt.getTime())) return null;
  const echoes =
    dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
  return echoes ? dt : null;
}
