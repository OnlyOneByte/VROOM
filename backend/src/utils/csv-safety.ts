// CSV readers must run denormalizeCsvCell, or exported formula escapes leak into re-imported cells.

const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

function isApostropheRunThenTrigger(s: string): boolean {
  let i = 0;
  while (i < s.length && s[i] === "'") i++;
  return i < s.length && FORMULA_TRIGGERS.has(s[i] as string);
}

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

export function denormalizeCsvCell(value: string): string {
  return value[0] === "'" && isApostropheRunThenTrigger(value) ? value.slice(1) : value;
}
