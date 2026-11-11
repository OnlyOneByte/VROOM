import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const RESTORE_OK = { restored: true, tablesRestored: 1 };

function restoreOpts(mode: 'preview' | 'replace' | 'merge') {
	return {
		providerId: 'p1',
		sourceType: 'zip' as const,
		mode,
		idempotencyKey: `restore-${mode}-key`
	};
}

describe('settings store — restoreFromProvider mode-gated reload + error path', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		settingsStore.reset();
	});

	it('a non-preview (replace) restore reloads settings afterward (2 fetches: restore + GET /settings)', async () => {
		mockFetch.mockResolvedValueOnce(okJson(RESTORE_OK));
		mockFetch.mockResolvedValueOnce(okJson({ unitPreferences: {} }));

		const result = await settingsStore.restoreFromProvider(restoreOpts('replace'));

		expect(result).toEqual(RESTORE_OK);
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it('a preview restore does NOT reload (1 fetch only — the dry-run view must survive)', async () => {
		mockFetch.mockResolvedValueOnce(okJson(RESTORE_OK));

		await settingsStore.restoreFromProvider(restoreOpts('preview'));

		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it('a merge restore also reloads (the non-preview branch covers replace AND merge)', async () => {
		mockFetch.mockResolvedValueOnce(okJson(RESTORE_OK));
		mockFetch.mockResolvedValueOnce(okJson({ unitPreferences: {} }));

		await settingsStore.restoreFromProvider(restoreOpts('merge'));

		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it('a failed restore SETS store.error and re-throws (never swallows a restore failure)', async () => {
		mockFetch.mockResolvedValueOnce(errJson(500, 'restore exploded'));

		await expect(settingsStore.restoreFromProvider(restoreOpts('replace'))).rejects.toBeDefined();
		expect(settingsStore.error, 'a failed restore must surface its error').toBeTruthy();
	});
});
