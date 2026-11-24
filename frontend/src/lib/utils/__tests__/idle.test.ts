import { afterEach, describe, expect, test, vi } from 'vitest';
import { loadWhenIdle } from '../idle.ts';

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('loadWhenIdle', () => {
	test('starts each load in its own idle period, after the one before settles', async () => {
		const idle: (() => void)[] = [];
		vi.stubGlobal('requestIdleCallback', (callback: () => void) => idle.push(callback));
		const started: string[] = [];
		let finishFirst: () => void = () => {};
		const first = () => {
			started.push('first');
			return new Promise<void>(resolve => {
				finishFirst = resolve;
			});
		};
		const second = () => {
			started.push('second');
			return Promise.resolve();
		};

		loadWhenIdle([first, second]);
		expect(started).toEqual([]);

		idle.shift()?.();
		expect(started).toEqual(['first']);
		expect(idle).toHaveLength(0);

		finishFirst();
		await Promise.resolve();
		await Promise.resolve();
		idle.shift()?.();
		expect(started).toEqual(['first', 'second']);
	});

	test('a failed load does not stop the ones after it', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('requestIdleCallback', undefined);
		const later = vi.fn(() => Promise.resolve());

		loadWhenIdle([() => Promise.reject(new Error('offline')), later]);
		await vi.runAllTimersAsync();

		expect(later).toHaveBeenCalledOnce();
	});
});
