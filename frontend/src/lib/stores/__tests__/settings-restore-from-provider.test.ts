/**
 * Guard (C128) for the settings store's `restoreFromProvider` — the provider-path RESTORE method
 * (NORTH_STAR #1 data-safety). Coverage showed lines 142-148 untested: the mode-gated post-restore
 * reload + the error-set-and-rethrow failure path were both unpinned in the STORE (settings-api.test.ts
 * pins only the WIRE/body contract; settings-error-clearing.test.ts C308 pins error-CLEAR-on-entry +
 * one error-set case on listAllBackups, never restoreFromProvider).
 *
 * The load-bearing invariants pinned here (the C319/C100 mode-gated-reload class on the provider twin —
 * uploadBackup got this at C100, restoreFromProvider did not):
 *   - a NON-preview restore (replace/merge) must `await this.load()` so the UI reflects the restored
 *     data — a dropped reload leaves STALE pre-restore settings on screen (silent NORTH_STAR #1 footgun).
 *   - a PREVIEW restore must NOT reload (it's a dry-run; reloading would discard the unsaved view).
 *   - a thrown API error must SET `store.error` and RE-THROW (don't swallow a restore failure).
 *
 * Drives the store through the real settingsApi → apiClient → fetch (mocked), the C308 pattern. The
 * reload is observed via the EXTRA GET /settings fetch a non-preview restore issues.
 */

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

describe('settings store — restoreFromProvider mode-gated reload + error path (C128)', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		settingsStore.reset();
	});

	it('a non-preview (replace) restore reloads settings afterward (2 fetches: restore + GET /settings)', async () => {
		mockFetch.mockResolvedValueOnce(okJson(RESTORE_OK)); // the restore POST
		mockFetch.mockResolvedValueOnce(okJson({ unitPreferences: {} })); // the this.load() GET

		const result = await settingsStore.restoreFromProvider(restoreOpts('replace'));

		expect(result).toEqual(RESTORE_OK);
		expect(mockFetch).toHaveBeenCalledTimes(2); // restore + reload
	});

	it('a preview restore does NOT reload (1 fetch only — the dry-run view must survive)', async () => {
		mockFetch.mockResolvedValueOnce(okJson(RESTORE_OK)); // the restore POST only

		await settingsStore.restoreFromProvider(restoreOpts('preview'));

		expect(mockFetch).toHaveBeenCalledTimes(1); // NO reload
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
