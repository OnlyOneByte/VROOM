// Keep IN-clauses under SQLite's host-parameter limit. Callers building one from an unbounded list
// must chunk by this.
export const SQLITE_BATCH_SIZE = 500;

// bun-sqlite stores the bind count in 16 bits, so a larger statement fails with a misleading error.
export const SQLITE_MAX_BIND_PARAMS = 65_535;

// Caps multi-row INSERTs so the bind count stays under SQLITE_MAX_BIND_PARAMS. Always at least one
// row.
export function rowsPerInsert(columnCount: number): number {
  if (columnCount < 1) throw new RangeError(`columnCount must be >= 1, got ${columnCount}`);
  return Math.max(1, Math.min(SQLITE_BATCH_SIZE, Math.floor(SQLITE_MAX_BIND_PARAMS / columnCount)));
}

// Returns [] for empty input and never yields an empty chunk.
export function chunk<T>(items: readonly T[], size: number = SQLITE_BATCH_SIZE): T[][] {
  if (size < 1) throw new RangeError(`chunk size must be >= 1, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
