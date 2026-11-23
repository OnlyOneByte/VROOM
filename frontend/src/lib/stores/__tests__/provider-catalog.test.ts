import { describe, expect, test, vi } from 'vitest';
import { STORAGE_CATALOG } from './provider-catalog-fixtures';

const getCatalog = vi.fn();
vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: { getCatalog: () => getCatalog() }
}));

const { providerCatalog } = await import('#lib/stores/provider-catalog.svelte.ts');

describe('providerCatalog', () => {
	test('a failed load reports the error and a retry fetches once for concurrent callers', async () => {
		getCatalog.mockRejectedValueOnce(new Error('offline'));
		await providerCatalog.load();
		expect(providerCatalog.loaded).toBe(false);
		expect(providerCatalog.error).toBeTruthy();
		expect(providerCatalog.entry('s3')).toBeNull();

		getCatalog.mockResolvedValue(STORAGE_CATALOG);
		await Promise.all([providerCatalog.load(), providerCatalog.ensureLoaded()]);
		expect(getCatalog).toHaveBeenCalledTimes(2);
		expect(providerCatalog.error).toBeNull();
		expect(providerCatalog.entry('s3')?.label).toBe('S3 Compatible');

		await providerCatalog.ensureLoaded();
		expect(getCatalog).toHaveBeenCalledTimes(2);
	});
});
