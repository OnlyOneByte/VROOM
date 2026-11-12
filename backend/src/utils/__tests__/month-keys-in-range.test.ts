import { describe, expect, test } from 'bun:test';
import { monthKeysInRange } from '../analytics-charts';

describe('monthKeysInRange — no month skipped on end-of-month starts', () => {
  test('Jan 31 to Apr 30 includes February', () => {
    const keys = monthKeysInRange(new Date(2024, 0, 31), new Date(2024, 3, 30));
    expect(keys).toEqual(['2024-01', '2024-02', '2024-03', '2024-04']);
  });

  test('day-31 start across a 6-month term keeps every month', () => {
    const keys = monthKeysInRange(new Date(2023, 7, 31), new Date(2024, 1, 28));
    expect(keys).toEqual([
      '2023-08',
      '2023-09',
      '2023-10',
      '2023-11',
      '2023-12',
      '2024-01',
      '2024-02',
    ]);
  });

  test('a normal mid-month start is unchanged', () => {
    const keys = monthKeysInRange(new Date(2024, 5, 15), new Date(2024, 7, 10));
    expect(keys).toEqual(['2024-06', '2024-07', '2024-08']);
  });

  test('same start/end month yields exactly one key', () => {
    expect(monthKeysInRange(new Date(2024, 2, 5), new Date(2024, 2, 25))).toEqual(['2024-03']);
  });

  test('null bounds or start-after-end yield no keys', () => {
    expect(monthKeysInRange(null, new Date(2024, 0, 1))).toEqual([]);
    expect(monthKeysInRange(new Date(2024, 0, 1), null)).toEqual([]);
    expect(monthKeysInRange(new Date(2024, 5, 1), new Date(2024, 2, 1))).toEqual([]);
  });
});
