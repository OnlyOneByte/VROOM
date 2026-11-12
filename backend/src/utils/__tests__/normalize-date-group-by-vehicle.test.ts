import { describe, expect, test } from 'bun:test';
import { groupByVehicle, normalizeDate } from '../analytics-charts';

describe('normalizeDate', () => {
  test('null returns null', () => {
    expect(normalizeDate(null)).toBeNull();
  });

  test('a Date instance is returned as-is (identity, not a copy through epoch math)', () => {
    const dt = new Date('2024-03-15T12:00:00.000Z');
    expect(normalizeDate(dt)).toBe(dt);
  });

  test('a SECONDS epoch (< 1e12) is multiplied by 1000', () => {
    const seconds = 1_700_000_000;
    const out = normalizeDate(seconds) as Date;
    expect(out.getTime()).toBe(seconds * 1000);
    expect(out.getUTCFullYear()).toBe(2023);
  });

  test('a MILLISECONDS epoch (>= 1e12) is used verbatim', () => {
    const ms = 1_700_000_000_000;
    const out = normalizeDate(ms) as Date;
    expect(out.getTime()).toBe(ms);
    expect(out.getUTCFullYear()).toBe(2023);
  });

  test('the 1e12 boundary itself is treated as milliseconds (NOT < 1e12 → no ×1000)', () => {
    const out = normalizeDate(1e12) as Date;
    expect(out.getTime()).toBe(1e12);
    expect(out.getUTCFullYear()).toBe(2001);
  });

  test('epoch 0 (< 1e12) maps to the Unix epoch (0 × 1000 = 0), not a non-Date', () => {
    const out = normalizeDate(0) as Date;
    expect(out.getTime()).toBe(0);
    expect(out.getUTCFullYear()).toBe(1970);
  });
});

describe('groupByVehicle', () => {
  test('empty input returns an empty map', () => {
    expect(groupByVehicle([]).size).toBe(0);
  });

  test('groups rows by vehicleId; each group preserves input order', () => {
    const rows = [
      { vehicleId: 'a', n: 1 },
      { vehicleId: 'b', n: 2 },
      { vehicleId: 'a', n: 3 },
      { vehicleId: 'a', n: 4 },
    ];
    const out = groupByVehicle(rows);
    expect(out.size).toBe(2);
    expect(out.get('a')?.map((r) => r.n)).toEqual([1, 3, 4]);
    expect(out.get('b')?.map((r) => r.n)).toEqual([2]);
  });

  test('a single vehicle yields one group containing every row', () => {
    const rows = [
      { vehicleId: 'v1', n: 1 },
      { vehicleId: 'v1', n: 2 },
    ];
    const out = groupByVehicle(rows);
    expect(out.size).toBe(1);
    expect(out.get('v1')).toHaveLength(2);
  });
});
