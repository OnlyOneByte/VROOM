/**
 * Unit tests for maxOf / minOf (calculations.ts) — the spread-safe array min/max (C235 deep-review).
 *
 * These replace 18 `Math.max(...arr)` / `Math.min(...arr)` sites across analytics-charts.ts,
 * analytics/repository.ts, and vehicle-stats.ts. The argument-spread form throws
 * `RangeError: Maximum call stack size exceeded` on a large array (a heavy logger's thousands of
 * un-LIMITed fuel/mileage rows over the all-time window) — crashing the analytics request. The
 * load-bearing test is `does NOT throw on a huge array`; the rest pin behavior-IDENTITY with
 * Math.max/min so every existing call site is unchanged (incl. the empty → ±Infinity contract the
 * callers already guard).
 */

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
    // The whole point of matching this: a call site that does `arr.length > 0 ? maxOf(arr) : null`
    // (or guards with `length >= 2`) behaves identically to the old `Math.max(...arr)`.
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

describe('maxOf / minOf — the regression: scales to a huge array (no argument-spread)', () => {
  test('returns correctly on 500k elements (the spread form risks a RangeError under V8)', () => {
    // maxOf/minOf reduce in O(n) with constant stack, so a heavy logger's thousands-to-millions of
    // un-LIMITed analytics rows are safe. `Math.max(...big)` spreads every element as an argument and
    // throws `RangeError: Maximum call stack size exceeded` once the count exceeds the engine's
    // argument cap (V8 ~65k; the exact threshold is engine- and stack-depth-dependent, so we don't
    // assert the throw here — we assert maxOf/minOf compute the right answer at a size that exercises
    // the no-spread path well beyond that cap).
    const big = new Array(500_000);
    for (let i = 0; i < big.length; i++) big[i] = i;
    big[123_456] = 999_999_999; // a known max somewhere in the middle
    big[234_567] = -42; // a known min

    expect(() => maxOf(big)).not.toThrow();
    expect(maxOf(big)).toBe(999_999_999);
    expect(minOf(big)).toBe(-42);
  });
});
