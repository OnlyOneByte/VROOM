/**
 * The SQLite host-parameter ceiling. An `inArray(col, ids)` compiles one bound parameter per id, so a
 * query over more than this many ids would exceed SQLite's variable limit (999 historically; 500 is a
 * safe margin). Callers that build an IN-clause from an unbounded id list MUST chunk by this size.
 */
export const SQLITE_BATCH_SIZE = 500;

/**
 * The hard ceiling on how many values ONE statement may bind. bun-sqlite carries that count in a
 * 16-bit field, so a statement over the ceiling reports a count taken mod 65536 — an error naming
 * neither the table nor a real number — instead of failing legibly. Reachable on a multi-row INSERT,
 * which binds one parameter per column per row: a single `.values(rows)` over a 25-column table caps
 * at 2,621 rows.
 */
export const SQLITE_MAX_BIND_PARAMS = 65_535;

/**
 * How many rows one multi-row INSERT over `columnCount` columns may carry. SQLITE_BATCH_SIZE is the
 * normal answer — it keeps statements small and matches the IN-clause batching, and at the widest
 * backed-up table (25 columns) binds 12,500 of the 65,535 available. A table wide enough that 500 rows
 * would approach the ceiling gets proportionally fewer rows instead, so the caller never has to know a
 * table's width. Always >= 1: a single row of even an absurdly wide table is still attempted.
 */
export function rowsPerInsert(columnCount: number): number {
  if (columnCount < 1) throw new RangeError(`columnCount must be >= 1, got ${columnCount}`);
  return Math.max(1, Math.min(SQLITE_BATCH_SIZE, Math.floor(SQLITE_MAX_BIND_PARAMS / columnCount)));
}

/**
 * Split `items` into consecutive sub-arrays of at most `size`. The shared primitive behind the
 * batched IN-clause loops in the photo / photo-ref repositories (cascade-delete + fan-out reads),
 * which each hand-rolled `for (let i = 0; i < ids.length; i += 500) { ids.slice(i, i + 500) }` with
 * their own copy of the 500 constant — 4+ sites. One source of truth so the batch size + the chunk
 * boundary math can't drift (a divergent copy that mis-strided would silently drop or double-process
 * a batch — data loss on a cascade DELETE). Returns [] for an empty input; never returns empty chunks.
 * `size` must be >= 1.
 */
export function chunk<T>(items: readonly T[], size: number = SQLITE_BATCH_SIZE): T[][] {
  if (size < 1) throw new RangeError(`chunk size must be >= 1, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
