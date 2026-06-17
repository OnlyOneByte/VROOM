/**
 * Unit tests for chunk() — the shared batching primitive (C397) behind the photo / photo-ref
 * repositories' batched IN-clause loops (cascade-delete fan-outs that must stay under SQLite's
 * variable limit). Pins the boundary math the 4 call sites now delegate: a divergent stride would
 * silently drop or double-process a batch on a destructive cascade DELETE (data loss).
 */

import { describe, expect, test } from 'bun:test';
import { chunk, SQLITE_BATCH_SIZE } from '../chunk';

describe('chunk', () => {
  test('empty input → no chunks (the cascade no-op path)', () => {
    expect(chunk([], 500)).toEqual([]);
  });

  test('fewer than one batch → a single chunk with all items', () => {
    expect(chunk([1, 2, 3], 500)).toEqual([[1, 2, 3]]);
  });

  test('an EXACT multiple of size splits into full chunks with no trailing empty', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test('a non-multiple leaves the remainder in a final short chunk', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  test('every element appears exactly once, in order (no drop / no dup — the data-loss guard)', () => {
    const items = Array.from({ length: 1250 }, (_, i) => i); // 2 full 500-batches + a 250 remainder
    const chunks = chunk(items, SQLITE_BATCH_SIZE);
    expect(chunks.length).toBe(3);
    expect(chunks.map((c) => c.length)).toEqual([500, 500, 250]);
    expect(chunks.flat()).toEqual(items); // flatten round-trips the original exactly
  });

  test('defaults to SQLITE_BATCH_SIZE (500) when size omitted', () => {
    expect(SQLITE_BATCH_SIZE).toBe(500);
    const items = Array.from({ length: 501 }, (_, i) => i);
    const chunks = chunk(items);
    expect(chunks.map((c) => c.length)).toEqual([500, 1]);
  });

  test('a size < 1 throws (never an infinite loop)', () => {
    expect(() => chunk([1, 2], 0)).toThrow(RangeError);
  });
});
