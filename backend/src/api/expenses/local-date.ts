/**
 * Builds a local-time Date from parts, or null when the parts are impossible. Constructing
 * from numeric parts (not an ISO string) keeps the intended calendar day in local time, and
 * the echo check rejects Feb 30 or month 13, which JS would otherwise silently roll over.
 */
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
