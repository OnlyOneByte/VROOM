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
		expect(calls).toBe(1);
	});

	test('distinct argument tuples are cached independently', () => {
		let calls = 0;
		const add = memoizeMulti((a: number, b: number) => {
			calls += 1;
			return a + b;
		});
		expect(add(1, 1)).toBe(2);
		expect(add(2, 2)).toBe(4);
		expect(add(1, 1)).toBe(2);
		expect(calls).toBe(2);
	});

	test('the oldest entry is evicted once the cache exceeds MAX_CACHE_SIZE (100)', () => {
		let calls = 0;
		const square = memoizeMulti((n: number) => {
			calls += 1;
			return n * n;
		});
		for (let i = 0; i < 100; i++) square(i);
		expect(calls).toBe(100);

		square(50);
		expect(calls).toBe(100);

		square(100);
		expect(calls).toBe(101);

		square(0);
		expect(calls).toBe(102);

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
		expect(describe({ id: 7 })).toBe(70);
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
		expect(calls).toBe(0);
		vi.advanceTimersByTime(199);
		expect(calls).toBe(0);
		vi.advanceTimersByTime(1);
		expect(calls).toBe(1);
	});

	test('the trailing call uses the LATEST args, and the timer resets on each call', () => {
		const seen: number[] = [];
		const fn = debounce((n: number) => seen.push(n), 100);
		fn(1);
		vi.advanceTimersByTime(50);
		fn(2);
		vi.advanceTimersByTime(50);
		expect(seen).toEqual([]);
		vi.advanceTimersByTime(50);
		expect(seen).toEqual([2]);
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
