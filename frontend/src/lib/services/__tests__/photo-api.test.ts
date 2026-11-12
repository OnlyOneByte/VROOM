import { beforeEach, describe, expect, test, vi } from 'vitest';

const post = vi.fn();
const del = vi.fn();
const getPaginated = vi.fn();
vi.mock('$app/env/public', () => ({ PUBLIC_API_URL: 'https://api.example.com' }));
vi.mock('../api-client', async importOriginal => ({
	...(await importOriginal<typeof import('../api-client')>()),
	apiClient: { post, delete: del, getPaginated }
}));

const { entityPhotos } = await import('../photo-api');
const { expenseApi } = await import('../expense-api');
const { insuranceApi } = await import('../insurance-api');
const { odometerApi } = await import('../odometer-api');

beforeEach(() => {
	for (const fn of [post, del, getPaginated]) fn.mockReset();
});

describe('entityPhotos', () => {
	test('list paginates under /photos/:entityType/:entityId', async () => {
		await entityPhotos('expense', 'e1').list({ limit: 5, offset: 10 });
		expect(getPaginated).toHaveBeenCalledWith('/api/v1/photos/expense/e1?limit=5&offset=10');
	});

	test('upload posts the file as the "photo" form field', async () => {
		const file = new File(['x'], 'r.jpg');
		await entityPhotos('expense', 'e1').upload(file);
		const [url, body] = post.mock.calls[0] ?? [];
		expect(url).toBe('/api/v1/photos/expense/e1');
		expect((body as FormData).get('photo')).toBeInstanceOf(File);
	});

	test('remove and thumbnailUrl address one photo', async () => {
		await entityPhotos('insurance_claim', 'c1').remove('p1');
		expect(del).toHaveBeenCalledWith('/api/v1/photos/insurance_claim/c1/p1');
		expect(entityPhotos('insurance_claim', 'c1').thumbnailUrl('p1')).toBe(
			'https://api.example.com/api/v1/photos/insurance_claim/c1/p1/thumbnail'
		);
	});
});

describe('domain photo wrappers route through entityPhotos', () => {
	test('expense, insurance, and odometer hit the same endpoints', async () => {
		const file = new File(['x'], 'r.jpg');
		await expenseApi.uploadPhoto('expense', 'e1', file);
		await insuranceApi.uploadEntityDocument('insurance_policy', 'pol1', file);
		await odometerApi.uploadPhoto('o1', file);

		expect(post.mock.calls.map(c => c[0])).toEqual([
			'/api/v1/photos/expense/e1',
			'/api/v1/photos/insurance_policy/pol1',
			'/api/v1/photos/odometer_entry/o1'
		]);
		expect(insuranceApi.getEntityDocumentThumbnailUrl('insurance_policy', 'pol1', 'd1')).toBe(
			'https://api.example.com/api/v1/photos/insurance_policy/pol1/d1/thumbnail'
		);
	});
});
