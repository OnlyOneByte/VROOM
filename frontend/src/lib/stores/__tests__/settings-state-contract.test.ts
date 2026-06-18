/**
 * Guard for the settings store's STATE-MANAGEMENT contracts (C319 — settings.svelte.ts was ~12% covered;
 * C308 pinned only the error-clearing invariant). These pin the behaviors the UI depends on:
 *   1. update() replaces `settings` state with the server response + returns it (the unitPreferences /
 *      currency render reads off this), and on failure RE-THROWS (so the caller's await rejects) while
 *      still recording the error.
 *   2. a non-preview restoreFromProvider REFRESHES state via this.load() (a destructive restore changes
 *      the stored settings, so stale in-memory state would mislead — NORTH_STAR #1); a PREVIEW restore
 *      does NOT reload (read-only — no state change to reflect).
 *   3. reset() clears all state (the logout path).
 *   4. the unitPreferences getter falls back to defaults when settings is null.
 *
 * Drives the real store → settings-api → apiClient → fetch (mocked), the auth.test.ts / C308 pattern.
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

const SETTINGS = {
	unitPreferences: { distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' },
	currencyUnit: 'EUR'
};

describe('settings store — state-management contracts (C319)', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		settingsStore.reset();
	});

	it('update() replaces settings state with the server response and returns it', async () => {
		mockFetch.mockResolvedValueOnce(okJson(SETTINGS));
		const returned = await settingsStore.update({ currencyUnit: 'EUR' });
		expect(returned).toEqual(SETTINGS);
		expect(settingsStore.settings).toEqual(SETTINGS);
		// the getter now reflects the updated prefs (the render path)
		expect(settingsStore.unitPreferences.distanceUnit).toBe('kilometers');
		expect(settingsStore.error).toBe(null);
	});

	it('update() RE-THROWS on failure (and records the error) so the caller await rejects', async () => {
		mockFetch.mockResolvedValueOnce(errJson(500, 'update failed'));
		await expect(settingsStore.update({ currencyUnit: 'EUR' })).rejects.toBeDefined();
		expect(settingsStore.error).toBeTruthy();
	});

	it('a non-preview restoreFromProvider REFRESHES state via load() (second fetch = the reload)', async () => {
		// 1st fetch = the restore POST; 2nd fetch = this.load()'s GET /settings.
		mockFetch
			.mockResolvedValueOnce(okJson({ success: true, imported: {} }))
			.mockResolvedValueOnce(okJson(SETTINGS));

		await settingsStore.restoreFromProvider({
			providerId: 'p1',
			sourceType: 'zip',
			mode: 'replace',
			idempotencyKey: 'k1'
		});

		expect(mockFetch).toHaveBeenCalledTimes(2); // restore + reload
		// State was refreshed from the post-restore GET.
		expect(settingsStore.settings).toEqual(SETTINGS);
	});

	it('a PREVIEW restoreFromProvider does NOT reload (read-only — no state change to reflect)', async () => {
		mockFetch.mockResolvedValueOnce(okJson({ success: true, preview: {} }));

		await settingsStore.restoreFromProvider({
			providerId: 'p1',
			sourceType: 'zip',
			mode: 'preview',
			idempotencyKey: 'k2'
		});

		expect(mockFetch).toHaveBeenCalledTimes(1); // restore only, no reload
		expect(settingsStore.settings).toBeNull(); // never loaded
	});

	// The uploadBackup twin of the restoreFromProvider reload contract (above). uploadBackup is the
	// FILE-upload restore path (the more common one — drag a .zip in), and it gates the post-restore
	// this.load() on `mode !== 'preview'` exactly like restoreFromProvider. C319 pinned the provider
	// path; this pins the file-upload path so a regression dropping its reload — which would leave the UI
	// showing STALE pre-restore settings after a replace/merge (NORTH_STAR #1 data-correctness) — goes RED.
	// (settings-api.test.ts pins uploadBackup's wire/FormData contract, not the store's mode-gated reload.)
	it('a non-preview uploadBackup REFRESHES state via load() (second fetch = the reload)', async () => {
		// 1st fetch = the restore upload; 2nd fetch = this.load()'s GET /settings.
		mockFetch
			.mockResolvedValueOnce(okJson({ success: true, imported: {} }))
			.mockResolvedValueOnce(okJson(SETTINGS));

		const file = new File(['backup-bytes'], 'vroom-backup.zip', { type: 'application/zip' });
		await settingsStore.uploadBackup(file, 'replace');

		expect(mockFetch).toHaveBeenCalledTimes(2); // upload + reload
		expect(settingsStore.settings).toEqual(SETTINGS); // refreshed from the post-restore GET
	});

	it('a PREVIEW uploadBackup does NOT reload (read-only — no state change to reflect)', async () => {
		mockFetch.mockResolvedValueOnce(okJson({ success: true, preview: {} }));

		const file = new File(['backup-bytes'], 'vroom-backup.zip', { type: 'application/zip' });
		await settingsStore.uploadBackup(file, 'preview');

		expect(mockFetch).toHaveBeenCalledTimes(1); // upload only, no reload
		expect(settingsStore.settings).toBeNull(); // never loaded
	});

	it('reset() clears settings, error, and loading state (the logout path)', async () => {
		mockFetch.mockResolvedValueOnce(okJson(SETTINGS));
		await settingsStore.load();
		expect(settingsStore.settings).toEqual(SETTINGS);

		settingsStore.reset();
		expect(settingsStore.settings).toBeNull();
		expect(settingsStore.error).toBeNull();
		expect(settingsStore.isLoading).toBe(false);
	});

	it('the unitPreferences getter falls back to defaults when settings is null', () => {
		// reset() leaves settings null → the getter must still return a usable default (miles/gallons).
		expect(settingsStore.settings).toBeNull();
		expect(settingsStore.unitPreferences.distanceUnit).toBe('miles');
		expect(settingsStore.unitPreferences.volumeUnit).toBe('gallons_us');
	});
});
