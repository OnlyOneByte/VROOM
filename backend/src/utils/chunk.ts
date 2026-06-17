/**
 * The SQLite host-parameter ceiling. An `inArray(col, ids)` compiles one bound parameter per id, so a
 * query over more than this many ids would exceed SQLite's variable limit (999 historically; 500 is a
 * safe margin). Callers that build an IN-clause from an unbounded id list MUST chunk by this size.
 */
export const SQLITE_BATCH_SIZE = 500;

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
