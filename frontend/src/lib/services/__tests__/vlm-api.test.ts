/**
 * vlm-api.ts client (vlm-receipt-parsing T5a, C514) — the C149/C163 service-test pattern: apiClient is
 * mocked so we assert the exact endpoint + multipart payload parseReceipt builds, and that it unwraps
 * the `{ draft }` envelope. The fork-free FE wrapper over the shipped POST /api/v1/receipts/parse.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

const post = vi.fn();
vi.mock('../api-client', () => ({
	apiClient: { post },
	getApiBaseUrl: () => ''
}));

const { vlmApi } = await import('../vlm-api');

beforeEach(() => {
	post.mockReset();
});

function fakeImage(): File {
	return new File([new Uint8Array([1, 2, 3])], 'receipt.jpg', { type: 'image/jpeg' });
}

describe('vlmApi.parseReceipt', () => {
	test('POSTs the image as multipart to /api/v1/receipts/parse and unwraps the draft', async () => {
		post.mockResolvedValue({
			draft: { amount: 42.5, date: '2024-03-15', category: 'fuel', vendor: 'Shell' }
		});

		const draft = await vlmApi.parseReceipt(fakeImage());

		expect(post).toHaveBeenCalledTimes(1);
		const call = post.mock.calls[0] ?? [];
		const url = call[0];
		const body = call[1];
		expect(url).toBe('/api/v1/receipts/parse');
		expect(body).toBeInstanceOf(FormData);
		expect((body as FormData).get('image')).toBeInstanceOf(File);
		expect(((body as FormData).get('image') as File).name).toBe('receipt.jpg');

		// The envelope's `draft` is returned directly.
		expect(draft).toEqual({ amount: 42.5, date: '2024-03-15', category: 'fuel', vendor: 'Shell' });
	});

	test('returns an empty draft as-is (a receipt the model could not read)', async () => {
		post.mockResolvedValue({ draft: {} });
		expect(await vlmApi.parseReceipt(fakeImage())).toEqual({});
	});

	test('propagates a client error (e.g. no provider configured / provider unreachable)', async () => {
		post.mockRejectedValue(new Error('No receipt-parsing (VLM) provider is configured.'));
		await expect(vlmApi.parseReceipt(fakeImage())).rejects.toThrow(/VLM\) provider is configured/);
	});
});
