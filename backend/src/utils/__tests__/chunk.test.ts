import { describe, expect, test } from 'bun:test';
import { chunk, rowsPerInsert, SQLITE_BATCH_SIZE, SQLITE_MAX_BIND_PARAMS } from '../chunk';

describe('chunk', () => {
  test('empty input gives no chunks', () => {
    expect(chunk([], 500)).toEqual([]);
  });

  test('fewer than one batch → a single chunk with all items', () => {
    expect(chunk([1, 2, 3], 500)).toEqual([[1, 2, 3]]);
  });

  test('an exact multiple of size splits into full chunks with no trailing empty', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test('a non-multiple leaves the remainder in a final short chunk', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  test('every element appears exactly once, in order', () => {
    const items = Array.from({ length: 1250 }, (_, i) => i);
    const chunks = chunk(items, SQLITE_BATCH_SIZE);
    expect(chunks.length).toBe(3);
    expect(chunks.map((c) => c.length)).toEqual([500, 500, 250]);
    expect(chunks.flat()).toEqual(items);
  });

  test('defaults to SQLITE_BATCH_SIZE (500) when size omitted', () => {
    expect(SQLITE_BATCH_SIZE).toBe(500);
    const items = Array.from({ length: 501 }, (_, i) => i);
    const chunks = chunk(items);
    expect(chunks.map((c) => c.length)).toEqual([500, 1]);
  });

  test('a size below 1 throws', () => {
    expect(() => chunk([1, 2], 0)).toThrow(RangeError);
  });
});

// A multi-row INSERT over the bind-parameter ceiling fails with a count that names neither the
// table nor a real number.
describe('rowsPerInsert', () => {
  test('a 25-column table still gets a full batch', () => {
    expect(rowsPerInsert(25)).toBe(SQLITE_BATCH_SIZE);
    expect(rowsPerInsert(25) * 25).toBeLessThan(SQLITE_MAX_BIND_PARAMS);
  });

  test('a table too wide for a full batch gets proportionally fewer rows', () => {
    expect(rowsPerInsert(200)).toBe(Math.floor(SQLITE_MAX_BIND_PARAMS / 200));
  });

  test('a single row is always attempted, however absurd the width', () => {
    expect(rowsPerInsert(SQLITE_MAX_BIND_PARAMS * 2)).toBe(1);
  });

  test('no width in SQLite range ever yields a batch over the ceiling', () => {
    for (let columns = 1; columns <= 2000; columns++) {
      expect(rowsPerInsert(columns) * columns).toBeLessThanOrEqual(SQLITE_MAX_BIND_PARAMS);
      expect(rowsPerInsert(columns)).toBeGreaterThanOrEqual(1);
    }
  });

  test('a column count below 1 throws', () => {
    expect(() => rowsPerInsert(0)).toThrow(RangeError);
  });
});
