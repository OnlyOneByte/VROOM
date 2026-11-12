import { describe, expect, test } from 'bun:test';
import { maxOf, minOf } from '../calculations';

describe('maxOf / minOf — correctness', () => {
  test('return the max / min of a populated array', () => {
    expect(maxOf([3, 1, 4, 1, 5, 9, 2, 6])).toBe(9);
    expect(minOf([3, 1, 4, 1, 5, 9, 2, 6])).toBe(1);
  });

  test('handle negatives and a single element', () => {
    expect(maxOf([-5, -2, -9])).toBe(-2);
    expect(minOf([-5, -2, -9])).toBe(-9);
    expect(maxOf([42])).toBe(42);
    expect(minOf([42])).toBe(42);
  });

  test('handle floats', () => {
    expect(maxOf([1.5, 2.25, 1.75])).toBe(2.25);
    expect(minOf([1.5, 2.25, 1.75])).toBe(1.5);
  });
});

describe('maxOf / minOf — behavior identity with Math.max/min', () => {
  test('empty array returns ±Infinity exactly like Math.max()/Math.min() (callers guard length)', () => {
    expect(maxOf([])).toBe(Number.NEGATIVE_INFINITY);
    expect(minOf([])).toBe(Number.POSITIVE_INFINITY);
    expect(maxOf([])).toBe(Math.max());
    expect(minOf([])).toBe(Math.min());
  });

  test('agree with Math.max/min on a small spreadable array (randomized parity)', () => {
    for (let trial = 0; trial < 50; trial++) {
      const arr = Array.from(
        { length: 1 + (trial % 20) },
        (_, i) => ((i * 7 + trial * 13) % 97) - 48
      );
      expect(maxOf(arr)).toBe(Math.max(...arr));
      expect(minOf(arr)).toBe(Math.min(...arr));
    }
  });
});

describe('maxOf / minOf — large arrays', () => {
  test('returns correct results on 500k elements', () => {
    const big = new Array(500_000);
    for (let i = 0; i < big.length; i++) big[i] = i;
    big[123_456] = 999_999_999;
    big[234_567] = -42;

    expect(() => maxOf(big)).not.toThrow();
    expect(maxOf(big)).toBe(999_999_999);
    expect(minOf(big)).toBe(-42);
  });
});
