// Neutralizes spreadsheet formula injection (CWE-1236) for one-way CSV export. Do not use it on
// round-trip data unless the reader strips the prefix symmetrically.

/** First-character triggers a spreadsheet treats as the start of a formula. */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

// Matches the exact shape neutralizeCsvCell escapes. A leading apostrophe followed by ordinary text
// does not match.
function isApostropheRunThenTrigger(s: string): boolean {
  let i = 0;
  while (i < s.length && s[i] === "'") i++;
  return i < s.length && FORMULA_TRIGGERS.has(s[i] as string);
}

// Adds one apostrophe to a string that starts with a formula trigger, after any existing apostrophe
// run. Prepending to the run keeps denormalizeCsvCell an exact inverse.
export function neutralizeCsvCell<T>(value: T): T | string {
  if (typeof value !== 'string' || value.length === 0) return value;
  return isApostropheRunThenTrigger(value) ? `'${value}` : value;
}

export function neutralizeCsvRow<T extends Record<string, unknown>>(
  row: T
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    out[key] = neutralizeCsvCell(row[key]);
  }
  return out;
}

// Removes the one apostrophe neutralizeCsvCell added. A bare formula with no leading apostrophe is
// left intact.
export function denormalizeCsvCell(value: string): string {
  return value[0] === "'" && isApostropheRunThenTrigger(value) ? value.slice(1) : value;
}
