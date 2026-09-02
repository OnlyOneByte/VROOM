/**
 * photos-import-api.ts client (photos-auto-expense T3) — the C149/C163 service-test pattern: apiClient is
 * mocked so we assert the exact endpoints + payloads, the draft→create-body mapping, and crucially the
 * `clientId = photos:<photoId>` idempotency key the confirm path must send. The fork-free FE wrapper over
 * the shipped GET /api/v1/photos/receipt-drafts (stage) + the unchanged POST /api/v1/expenses (confirm).
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();
vi.mock('../api-client', () => ({
	apiClient: { get, post },
	getApiBaseUrl: () => ''
}));

const { photosImportApi } = await import('../photos-import-api');

beforeEach(() => {
	get.mockReset();
	post.mockReset();
});

describe('photosImportApi.getReceiptDrafts', () => {
	test('GETs the stage endpoint and returns the drafts array', async () => {
		const drafts = [
			{ photoId: 'm-1', draft: { amount: 12.5, category: 'fuel' }, thumbnailUrl: 'https://x/m-1' },
			{ photoId: 'm-2', draft: {}, thumbnailUrl: null }
		];
		get.mockResolvedValue({ drafts });

		const out = await photosImportApi.getReceiptDrafts();

		expect(get).toHaveBeenCalledTimes(1);
		expect(get.mock.calls[0]?.[0]).toBe('/api/v1/photos/receipt-drafts');
		expect(out).toEqual(drafts);
	});

	test('propagates an error from the client (e.g. a 502 Photos failure)', async () => {
		get.mockRejectedValue(new Error('502'));
		await expect(photosImportApi.getReceiptDrafts()).rejects.toThrow('502');
	});
});

describe('photosImportApi.confirmDraft', () => {
	test('POSTs to /expenses with the photos:<id> clientId and the mapped draft body', async () => {
		post.mockResolvedValue({ id: 'exp-new' });

		const out = await photosImportApi.confirmDraft('m-1', {
			vehicleId: 'veh-1',
			category: 'fuel',
			amount: 47.83,
			date: '2026-03-12',
			mileage: 84231,
			volume: 12.4,
			description: 'Shell'
		});

		expect(post).toHaveBeenCalledTimes(1);
		const [url, body] = post.mock.calls[0] ?? [];
		expect(url).toBe('/api/v1/expenses');
		// The idempotency key is the crux of D3 — a re-import must be a no-op.
		expect(body.clientId).toBe('photos:m-1');
		// Draft fields mapped to the backend shape (dollars → expenseAmount; the money-cents boundary is
		// the route's job, not the client's).
		expect(body.vehicleId).toBe('veh-1');
		expect(body.category).toBe('fuel');
		expect(body.expenseAmount).toBe(47.83);
		expect(body.mileage).toBe(84231);
		expect(body.volume).toBe(12.4);
		expect(body.description).toBe('Shell');
		expect(body.date).toBe('2026-03-12');
		expect(out).toEqual({ id: 'exp-new' });
	});

	test('a different photo yields a different clientId (no cross-photo dedup collision)', async () => {
		post.mockResolvedValue({ id: 'exp-2' });
		await photosImportApi.confirmDraft('m-2', { vehicleId: 'veh-1', category: 'misc', amount: 5 });
		expect(post.mock.calls[0]?.[1].clientId).toBe('photos:m-2');
	});

	test('propagates a create error (e.g. validation 400)', async () => {
		post.mockRejectedValue(new Error('400'));
		await expect(
			photosImportApi.confirmDraft('m-1', { vehicleId: 'veh-1', category: 'misc', amount: 1 })
		).rejects.toThrow('400');
	});
});
