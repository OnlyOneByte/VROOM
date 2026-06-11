/**
 * Characterization net for the memoize/debounce primitives (guard, C118 — FE coverage ratchet).
 *
 * These two reusable helpers had ZERO direct coverage, yet a bug in either silently corrupts every
 * consumer: memoizeMulti caches expensive calc results (a wrong-key or stale-hit serves wrong data),
 * and debounce collapses rapid calls (a dropped trailing call or a fired-too-early call misbehaves).
 * High-risk pure logic, untested — the C82 class. The C107 reading flagged FRONTEND as the bigger
 * coverage gap; this is a FE guard pick per that steer.
 *
 * Pins: cache hit returns the memoized value WITHOUT re-invoking fn; distinct args → distinct entries;
 * the MAX_CACHE_SIZE=100 oldest-key eviction; and debounce's collapse-to-one-trailing-call with the
 * LATEST args, via vitest fake timers.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { debounce, memoizeMulti } from '../memoize';

describe('memoizeMulti', () => {
  test('a repeated call returns the cached result WITHOUT re-invoking fn', () => {
    let calls = 0;
    const add = memoizeMulti((a: number, b: number) => {
      calls += 1;
      return a + b;
    });
    expect(add(2, 3)).toBe(5);
    expect(add(2, 3)).toBe(5);
    expect(add(2, 3)).toBe(5);
    expect(calls).toBe(1); // computed once, served from cache thereafter
  });

  test('distinct argument tuples are cached independently', () => {
    let calls = 0;
    const add = memoizeMulti((a: number, b: number) => {
      calls += 1;
      return a + b;
    });
    expect(add(1, 1)).toBe(2);
    expect(add(2, 2)).toBe(4);
    expect(add(1, 1)).toBe(2); // first key still cached
    expect(calls).toBe(2); // one per distinct tuple, the repeat is a hit
  });

  test('the oldest entry is evicted once the cache exceeds MAX_CACHE_SIZE (100)', () => {
    let calls = 0;
    const square = memoizeMulti((n: number) => {
      calls += 1;
      return n * n;
    });
    // Fill the cache with keys 0..99 (100 entries). The size check (`>= 100`) runs BEFORE each set,
    // so inserting key 99 sees size 99 → no evict; the cache ends holding {0..99}.
    for (let i = 0; i < 100; i++) square(i);
    expect(calls).toBe(100);

    // A still-cached key is a hit (no recompute) — proves the fill didn't already over-evict.
    square(50);
    expect(calls).toBe(100);

    // 101st distinct key: size is 100 ≥ 100 → evict the OLDEST (key 0), then insert 100. {1..100}.
    square(100);
    expect(calls).toBe(101);

    // Key 0 was evicted → a miss → recompute. Note this insert ALSO evicts the now-oldest (key 1),
    // because every over-cap insert evicts one more oldest key (the eviction cascade — the subtle bit).
    square(0);
    expect(calls).toBe(102);

    // So key 1, just evicted by the square(0) insert, is now ALSO a miss → recompute.
    square(1);
    expect(calls).toBe(103);
  });

  test('argument identity is by JSON value, not reference (object args with equal shape hit)', () => {
    let calls = 0;
    const describe = memoizeMulti((o: { id: number }) => {
      calls += 1;
      return o.id * 10;
    });
    expect(describe({ id: 7 })).toBe(70);
    expect(describe({ id: 7 })).toBe(70); // a DIFFERENT object, same JSON → cache hit
    expect(calls).toBe(1);
  });
});

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('collapses a burst of calls into ONE trailing invocation after the delay', () => {
    let calls = 0;
    const fn = debounce(() => {
      calls += 1;
    }, 200);
    fn();
    fn();
    fn();
    expect(calls).toBe(0); // nothing fires until the delay elapses
    vi.advanceTimersByTime(199);
    expect(calls).toBe(0); // still within the window
    vi.advanceTimersByTime(1);
    expect(calls).toBe(1); // exactly one trailing call at the boundary
  });

  test('the trailing call uses the LATEST args, and the timer resets on each call', () => {
    const seen: number[] = [];
    const fn = debounce((n: number) => seen.push(n), 100);
    fn(1);
    vi.advanceTimersByTime(50);
    fn(2); // resets the 100ms window
    vi.advanceTimersByTime(50); // 100ms since fn(1) but only 50ms since fn(2) → not yet
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(50); // now 100ms since fn(2)
    expect(seen).toEqual([2]); // only the latest args, fired once
  });

  test('calls separated by more than the delay each fire', () => {
    let calls = 0;
    const fn = debounce(() => {
      calls += 1;
    }, 100);
    fn();
    vi.advanceTimersByTime(100);
    fn();
    vi.advanceTimersByTime(100);
    expect(calls).toBe(2);
  });
});
