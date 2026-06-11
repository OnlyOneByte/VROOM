/**
 * Coverage ratchet (guard, C169) for settings-api.ts — the last FE service-layer sibling at ~7% line
 * (the C143 api-client / C149 expense-api / C163 reminder-api ratchet covered the rest). Every settings/
 * sync/backup/restore UI call routes through this module; its method→endpoint wiring + the load-bearing
 * restore-body branching + the Idempotency-Key headers (the double-restore data-safety guard) were
 * unexercised.
 *
 * apiClient is mocked (the C143/C149/C163 file-scoped vi.mock pattern — NOT the process-global mock.module
 * trap) so each test asserts the exact URL + verb + body + headers the real method builds.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const raw = vi.fn();
vi.mock('../api-client', () => ({
	apiClient: { get, post, put, raw }
}));

const { settingsApi } = await import('../settings-api');

beforeEach(() => {
	for (const fn of [get, post, put, raw]) fn.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('settingsApi — settings + sync wiring', () => {
	test('getSettings GETs /settings', async () => {
		get.mockResolvedValueOnce({ unitPreferences: {} });
		await settingsApi.getSettings();
		expect(get).toHaveBeenCalledWith('/api/v1/settings');
	});

	test('updateSettings PUTs /settings with the partial body', async () => {
		put.mockResolvedValueOnce({});
		const updates = { currencyUnit: 'EUR' };
		await settingsApi.updateSettings(updates);
		expect(put).toHaveBeenCalledWith('/api/v1/settings', updates);
	});

	test('executeSync POSTs /sync with syncTypes + force (default false)', async () => {
		post.mockResolvedValueOnce({ success: true });
		await settingsApi.executeSync(['backup']);
		expect(post).toHaveBeenCalledWith('/api/v1/sync', { syncTypes: ['backup'], force: false });
	});

	test('executeSync passes force=true when given', async () => {
		post.mockResolvedValueOnce({ success: true });
		await settingsApi.executeSync(['backup'], true);
		expect(post).toHaveBeenCalledWith('/api/v1/sync', { syncTypes: ['backup'], force: true });
	});
});

describe('settingsApi — backup listing', () => {
	test('listBackupsFromProvider URL-encodes the providerId (special chars survive)', async () => {
		get.mockResolvedValueOnce([]);
		await settingsApi.listBackupsFromProvider('prov id/with&special');
		// encodeURIComponent must escape the space, slash, and ampersand so the query parses correctly.
		expect(get).toHaveBeenCalledWith(
			'/api/v1/sync/backups/providers?providerId=prov%20id%2Fwith%26special'
		);
	});

	test('listAllBackups GETs the providers list (no query)', async () => {
		get.mockResolvedValueOnce([]);
		await settingsApi.listAllBackups();
		expect(get).toHaveBeenCalledWith('/api/v1/sync/backups/providers');
	});

	test('getRestoreProviders GETs the restore-providers list', async () => {
		get.mockResolvedValueOnce([]);
		await settingsApi.getRestoreProviders();
		expect(get).toHaveBeenCalledWith('/api/v1/sync/restore/providers');
	});

	test('downloadBackup uses apiClient.raw (returns the raw Response for the file)', async () => {
		raw.mockResolvedValueOnce(new Response('zip-bytes'));
		await settingsApi.downloadBackup();
		expect(raw).toHaveBeenCalledWith('/api/v1/sync/backups/download');
	});
});

describe('settingsApi.restoreFromProvider — body branching + idempotency', () => {
	test('zip source includes fileRef in the body + sends the Idempotency-Key header', async () => {
		post.mockResolvedValueOnce({ success: true });
		await settingsApi.restoreFromProvider({
			providerId: 'p1',
			sourceType: 'zip',
			mode: 'replace',
			fileRef: 'backups/2024.zip',
			idempotencyKey: 'idem-zip-1'
		});
		expect(post).toHaveBeenCalledWith(
			'/api/v1/sync/restore/from-provider',
			{ providerId: 'p1', sourceType: 'zip', fileRef: 'backups/2024.zip', mode: 'replace' },
			{ headers: { 'Idempotency-Key': 'idem-zip-1' } }
		);
	});

	test('sheets source OMITS fileRef (the branch that drops it) + sends the idempotency header', async () => {
		post.mockResolvedValueOnce({ success: true });
		await settingsApi.restoreFromProvider({
			providerId: 'p2',
			sourceType: 'sheets',
			mode: 'merge',
			idempotencyKey: 'idem-sheets-1'
		});
		const [, body] = post.mock.calls[0] as [string, Record<string, string>, unknown];
		expect(body).toEqual({ providerId: 'p2', sourceType: 'sheets', mode: 'merge' });
		expect(body).not.toHaveProperty('fileRef');
		expect(post.mock.calls[0]?.[2]).toEqual({ headers: { 'Idempotency-Key': 'idem-sheets-1' } });
	});
});

describe('settingsApi.uploadBackup — FormData + idempotency', () => {
	test('builds FormData with file + mode and POSTs with the Idempotency-Key header', async () => {
		post.mockResolvedValueOnce({ success: true });
		const file = new File(['zip-bytes'], 'backup.zip', { type: 'application/zip' });
		await settingsApi.uploadBackup(file, 'preview', 'idem-up-1');

		const [url, body, opts] = post.mock.calls[0] as [string, FormData, { headers: object }];
		expect(url).toBe('/api/v1/sync/restore/from-backup');
		expect(body).toBeInstanceOf(FormData);
		expect((body as FormData).get('file')).toBe(file);
		expect((body as FormData).get('mode')).toBe('preview');
		expect(opts).toEqual({ headers: { 'Idempotency-Key': 'idem-up-1' } });
	});
});
