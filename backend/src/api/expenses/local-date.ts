/**
 * Shared local-time date construction for the CSV import paths.
 *
 * Both the native importer (`import-csv.ts parseDate`) and the foreign-tracker
 * mapping pre-pass (`import-mapping.ts normalizeForeignDate`) need to build a Date
 * from explicit Y/M/D(/time) parts in LOCAL time, and BOTH must reject an impossible
 * value rather than let JS silently roll it over. This module is the single source of
 * truth for that guard so the two import paths can't drift (cycle-6/11 + bug #23/#59).
 */

/**
 * Build a LOCAL-time Date from explicit parts, returning `null` if any part is out of
 * range or impossible.
 *
 * Two reasons this is more than `new Date(...)`:
 * 1. **Local time, not UTC.** `new Date('2024-03-15')` parses as UTC midnight, which
 *    rolls the calendar day BACK for every user west of UTC; constructing from numeric
 *    parts keeps the user's intended day (cycle-6/11 discipline).
 * 2. **Echo-check, because JS rolls over silently.** `new Date(2024, 12, 45)` (i.e.
 *    "2024-13-45") is a VALID Date ~at 2025-02-14, and `new Date(2024, 1, 30)` (Feb 30)
 *    rolls to March — `Number.isNaN` alone can't catch either. We verify the constructed
 *    `getFullYear/getMonth/getDate` echo the input, so an out-of-range cell is rejected
 *    (bug #23 mapping path / #59 native path).
 *
 * A `null` return is the callers' signal to surface a clean per-row "Invalid date" error
 * rather than store a silently-rolled-over wrong date. `hh/mm/ss` default to 0 so a
 * date-only caller gets local midnight (identical to `new Date(year, month - 1, day)`).
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
