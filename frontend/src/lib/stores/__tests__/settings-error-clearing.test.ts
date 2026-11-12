import { describe, it, expect, vi, beforeEach } from 'vitest';
import { settingsStore } from '../settings.svelte';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function okJson(data: unknown) {
	return {
		ok: true,
		status: 200,
		headers: new Headers({ 'content-type': 'application/json' }),
		json: () => Promise.resolve({ success: true, data })
	};
}

function errJson(status: number, message = 'boom') {
	return {
		ok: false,
		status,
		headers: new Headers({ 'content-type': 'application/json' }),
		json: () => Promise.resolve({ error: { message } })
	};
}

describe('settings store — error is cleared on the entry of every async op', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		settingsStore.reset();
	});

	it('a successful loadRestoreProviders() clears a stale error left by a prior failed load()', async () => {
		mockFetch.mockResolvedValueOnce(errJson(500, 'load failed'));
		await settingsStore.load();
		expect(settingsStore.error, 'a failed load must set the error').toBeTruthy();

		mockFetch.mockResolvedValueOnce(okJson([{ id: 'p1', displayName: 'Drive', sourceTypes: [] }]));
		await settingsStore.loadRestoreProviders();
		expect(settingsStore.error, 'a succeeding op must clear the stale error').toBe(null);
	});

	it('a successful listAllBackups() clears a stale error too (symmetry across the ops)', async () => {
		mockFetch.mockResolvedValueOnce(errJson(500, 'load failed'));
		await settingsStore.load();
		expect(settingsStore.error).toBeTruthy();

		mockFetch.mockResolvedValueOnce(okJson([]));
		await settingsStore.listAllBackups();
		expect(settingsStore.error).toBe(null);
	});

	it('still SETS the error when an op itself fails (the clear-on-entry must not swallow real errors)', async () => {
		mockFetch.mockResolvedValueOnce(errJson(503, 'provider list down'));
		await expect(settingsStore.listAllBackups()).rejects.toBeDefined();
		expect(settingsStore.error, 'a failing op must still surface its error').toBeTruthy();
	});
});
