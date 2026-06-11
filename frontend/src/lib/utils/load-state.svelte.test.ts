/**
 * Unit tests for `createLoadState<T>()` (arch #2 scaffold). Pins the behaviour-preserving
 * contract the per-page triad has today, so a later cycle can migrate pages onto it with a
 * proven net: success stores data + clears error, failure runs onError + records the message
 * + leaves prior data intact, the message falls back for non-Error throws, isLoading toggles
 * around the run, and isError is the (error && !loading) four-states gate.
 */

import { describe, expect, test, vi } from 'vitest';
import { createLoadState } from './load-state.svelte';

describe('createLoadState', () => {
	test('starts with the configured initial value and not-loading by default', () => {
		const s = createLoadState<number>({ initial: 0 });
		expect(s.data).toBe(0);
		expect(s.isLoading).toBe(false);
		expect(s.error).toBeNull();
		expect(s.isError).toBe(false);
	});

	test('loadingInitially seeds isLoading true (a fetch-on-mount page)', () => {
		const s = createLoadState<string>({ loadingInitially: true });
		expect(s.isLoading).toBe(true);
		expect(s.data).toBeNull();
	});

	test('a successful run stores the value, clears error, and returns it', async () => {
		const s = createLoadState<{ n: number }>();
		const result = await s.run(async () => ({ n: 42 }));
		expect(result).toEqual({ n: 42 });
		expect(s.data).toEqual({ n: 42 });
		expect(s.error).toBeNull();
		expect(s.isError).toBe(false);
		expect(s.isLoading).toBe(false);
	});

	test('a failed run calls onError, records the message, and returns null', async () => {
		const onError = vi.fn();
		const s = createLoadState<number>({ onError });
		const result = await s.run(async () => {
			throw new Error('boom');
		});
		expect(result).toBeNull();
		expect(onError).toHaveBeenCalledTimes(1);
		expect(s.error).toBe('boom');
		expect(s.isError).toBe(true); // error && !loading → show error+retry
		expect(s.isLoading).toBe(false);
	});

	test('a failure leaves the PRIOR data intact (a returning user keeps their last view)', async () => {
		const s = createLoadState<number>();
		await s.run(async () => 7);
		expect(s.data).toBe(7);
		await s.run(async () => {
			throw new Error('refresh failed');
		});
		expect(s.data).toBe(7); // not wiped to null on failure
		expect(s.error).toBe('refresh failed');
	});

	test('a non-Error throw uses the fallback message', async () => {
		const s = createLoadState<number>({ fallbackMessage: 'Custom fallback' });
		await s.run(async () => {
			throw 'a bare string';
		});
		expect(s.error).toBe('Custom fallback');
	});

	test('the default fallback message is used when none is configured', async () => {
		const s = createLoadState<number>();
		await s.run(async () => {
			throw { weird: true };
		});
		expect(s.error).toBe('Failed to load');
	});

	test('a subsequent successful run clears a prior error', async () => {
		const s = createLoadState<number>();
		await s.run(async () => {
			throw new Error('first failed');
		});
		expect(s.isError).toBe(true);
		await s.run(async () => 99);
		expect(s.data).toBe(99);
		expect(s.error).toBeNull();
		expect(s.isError).toBe(false);
	});

	test('set() stores a value and clears the error (local-mutation path)', async () => {
		const s = createLoadState<number>();
		await s.run(async () => {
			throw new Error('x');
		});
		s.set(5);
		expect(s.data).toBe(5);
		expect(s.error).toBeNull();
	});

	test('clearError() drops the error without touching data (period-change-will-refetch path)', async () => {
		const s = createLoadState<number>();
		await s.run(async () => 3);
		await s.run(async () => {
			throw new Error('y');
		});
		expect(s.isError).toBe(true);
		s.clearError();
		expect(s.error).toBeNull();
		expect(s.isError).toBe(false);
		expect(s.data).toBe(3); // data preserved
	});
});
