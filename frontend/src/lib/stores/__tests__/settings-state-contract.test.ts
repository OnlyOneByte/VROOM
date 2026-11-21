import { describe, it, expect, vi, beforeEach } from 'vitest';
import { settingsStore } from '../settings.svelte';
import { themeStore } from '../theme.svelte';
import { SERVER_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';
import { setOfflineQueueOwner } from '#lib/utils/offline-storage.ts';

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

describe('settings store — state-management contracts', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		settingsStore.reset();
	});

	it('update() replaces settings state with the server response and returns it', async () => {
		mockFetch.mockResolvedValueOnce(okJson(SETTINGS));
		const returned = await settingsStore.update({ currencyUnit: 'EUR' });
		expect(returned).toEqual(SETTINGS);
		expect(settingsStore.settings).toEqual(SETTINGS);
		expect(settingsStore.unitPreferences.distanceUnit).toBe('kilometers');
		expect(settingsStore.error).toBe(null);
	});

	it('update() RE-THROWS on failure (and records the error) so the caller await rejects', async () => {
		mockFetch.mockResolvedValueOnce(errJson(500, 'update failed'));
		await expect(settingsStore.update({ currencyUnit: 'EUR' })).rejects.toBeDefined();
		expect(settingsStore.error).toBe(SERVER_FAILURE_MESSAGE);
	});

	it('a non-preview restoreFromProvider REFRESHES state (second fetch = the reload)', async () => {
		mockFetch
			.mockResolvedValueOnce(okJson({ success: true, imported: {} }))
			.mockResolvedValueOnce(okJson(SETTINGS));

		await settingsStore.restoreFromProvider({
			providerId: 'p1',
			sourceType: 'zip',
			mode: 'replace',
			idempotencyKey: 'k1'
		});

		expect(mockFetch).toHaveBeenCalledTimes(2);
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

		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(settingsStore.settings).toBeNull();
	});

	it('a non-preview uploadBackup REFRESHES state (second fetch = the reload)', async () => {
		mockFetch
			.mockResolvedValueOnce(okJson({ success: true, imported: {} }))
			.mockResolvedValueOnce(okJson(SETTINGS));

		const file = new File(['backup-bytes'], 'vroom-backup.zip', { type: 'application/zip' });
		await settingsStore.uploadBackup(file, 'replace');

		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(settingsStore.settings).toEqual(SETTINGS);
	});

	it('a PREVIEW uploadBackup does NOT reload (read-only — no state change to reflect)', async () => {
		mockFetch.mockResolvedValueOnce(okJson({ success: true, preview: {} }));

		const file = new File(['backup-bytes'], 'vroom-backup.zip', { type: 'application/zip' });
		await settingsStore.uploadBackup(file, 'preview');

		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(settingsStore.settings).toBeNull();
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
		expect(settingsStore.settings).toBeNull();
		expect(settingsStore.unitPreferences.distanceUnit).toBe('miles');
		expect(settingsStore.unitPreferences.volumeUnit).toBe('gallons_us');
	});

	it('concurrent load() calls share one request', async () => {
		mockFetch.mockResolvedValueOnce(okJson(SETTINGS));

		await Promise.all([settingsStore.load(), settingsStore.load(), settingsStore.load()]);

		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(settingsStore.settings).toEqual(SETTINGS);
	});

	it('load() after a successful load reuses it, and refresh() fetches again', async () => {
		mockFetch.mockResolvedValue(okJson(SETTINGS));
		await settingsStore.load();

		await settingsStore.load();
		expect(mockFetch).toHaveBeenCalledTimes(1);

		await settingsStore.refresh();
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it('load() after a failed load tries again', async () => {
		mockFetch.mockResolvedValueOnce(errJson(500)).mockResolvedValueOnce(okJson(SETTINGS));
		await settingsStore.load();
		expect(settingsStore.error).toBe(SERVER_FAILURE_MESSAGE);

		await settingsStore.load();
		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(settingsStore.settings).toEqual(SETTINGS);
	});

	it('load() fetches again for a different signed-in user', async () => {
		mockFetch.mockResolvedValue(okJson(SETTINGS));
		setOfflineQueueOwner('user-a');
		await settingsStore.load();

		setOfflineQueueOwner('user-b');
		await settingsStore.load();

		expect(mockFetch).toHaveBeenCalledTimes(2);
		setOfflineQueueOwner(null);
	});

	it('a response that arrives after the user changed is dropped', async () => {
		let answer: (value: unknown) => void = () => {};
		mockFetch.mockImplementationOnce(() => new Promise(resolve => (answer = resolve)));
		setOfflineQueueOwner('user-a');
		const pending = settingsStore.load();

		setOfflineQueueOwner('user-b');
		answer(okJson(SETTINGS));
		await pending;

		expect(settingsStore.settings).toBeNull();
		setOfflineQueueOwner(null);
	});

	it('a backup refreshes the settings it changed', async () => {
		mockFetch.mockResolvedValue(okJson(SETTINGS));
		await settingsStore.load();
		mockFetch
			.mockResolvedValueOnce(okJson({ results: {} }))
			.mockResolvedValueOnce(okJson({ ...SETTINGS, lastBackupDate: '2026-11-21T00:00:00.000Z' }));

		await settingsStore.executeSync(['backup'], true);

		expect(mockFetch).toHaveBeenCalledTimes(3);
		expect(settingsStore.settings?.lastBackupDate).toBe('2026-11-21T00:00:00.000Z');
	});
});

describe('settings store load() reconciles the server theme', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		settingsStore.reset();
		themeStore.setTheme('default');
		document.documentElement.removeAttribute('data-theme');
	});

	it('load() adopts the server themePreference (calls reconcileServerTheme with it)', async () => {
		mockFetch.mockResolvedValueOnce(okJson({ ...SETTINGS, themePreference: 'instrument' }));
		await settingsStore.load();
		expect(themeStore.themeId).toBe('instrument');
		expect(document.documentElement.getAttribute('data-theme')).toBe('instrument');
	});

	it('load() with no server themePreference leaves the local theme untouched (no-op reconcile)', async () => {
		themeStore.setTheme('instrument');
		document.documentElement.removeAttribute('data-theme');
		mockFetch.mockResolvedValueOnce(okJson(SETTINGS));
		await settingsStore.load();
		expect(themeStore.themeId).toBe('instrument');
	});
});
