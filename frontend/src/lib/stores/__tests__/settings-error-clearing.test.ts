/**
 * Regression (C308): the settings store must CLEAR a stale `error` at the start of every async
 * operation, not just load()/update().
 *
 * load() and update() reset `error = null` on entry, but downloadBackup / uploadBackup / executeSync /
 * listBackupsFromProvider / listAllBackups / restoreFromProvider / loadRestoreProviders did NOT — so a
 * failure from one operation left a stale error string sitting on the store, and a LATER successful
 * operation never cleared it. It's currently masked in the one UI consumer (settings/+page.svelte gates
 * `loadError` on `&& !settings`, i.e. initial-load only), but the inconsistency is a latent footgun: any
 * future component that renders `settingsStore.error` ungated would show a phantom error after a
 * succeeded retry. The fix adds `error = null` on entry to all seven; this pins it so the symmetry can't
 * regress.
 *
 * Drives the store through the real settingsApi → apiClient → fetch (mocked), the auth.test.ts pattern.
 */

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

describe('settings store — error is cleared on the entry of every async op (C308)', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		settingsStore.reset();
	});

	it('a successful loadRestoreProviders() clears a stale error left by a prior failed load()', async () => {
		// 1) load() fails → error is set.
		mockFetch.mockResolvedValueOnce(errJson(500, 'load failed'));
		await settingsStore.load();
		expect(settingsStore.error, 'a failed load must set the error').toBeTruthy();

		// 2) loadRestoreProviders() SUCCEEDS → it must clear the stale error on entry (the C308 fix;
		//    pre-fix this method never touched `error`, so the stale "load failed" persisted).
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
