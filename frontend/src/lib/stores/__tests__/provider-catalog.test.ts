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
		expect(providerCatalog.storageEntry('s3')).toBeNull();

		getCatalog.mockResolvedValue(STORAGE_CATALOG);
		await Promise.all([providerCatalog.load(), providerCatalog.ensureLoaded()]);
		expect(getCatalog).toHaveBeenCalledTimes(2);
		expect(providerCatalog.error).toBeNull();
		expect(providerCatalog.storageEntry('s3')?.label).toBe('S3 Compatible');

		await providerCatalog.ensureLoaded();
		expect(getCatalog).toHaveBeenCalledTimes(2);
	});

	test('sign-in and import entries never show up as storage or model providers', async () => {
		const { PROVIDER_CATALOG } = await import('./provider-catalog-fixtures');
		const base = { label: 'X', shortLabel: 'X', description: 'X', fields: [], secrets: [] };
		getCatalog.mockResolvedValueOnce([
			...PROVIDER_CATALOG,
			{
				...base,
				id: 'oidc',
				capability: 'auth',
				scope: 'server',
				connect: 'oauth',
				features: { pkce: true, verifiedEmail: true }
			},
			{
				...base,
				id: 'fuelio',
				capability: 'import',
				scope: 'builtin',
				connect: 'none',
				features: { accept: ['.csv'], detect: true }
			}
		]);
		vi.resetModules();
		const { providerCatalog: fresh } = await import('#lib/stores/provider-catalog.svelte.ts');
		await fresh.ensureLoaded();
		expect(fresh.storage.map(e => e.id)).not.toContain('oidc');
		expect(fresh.storageEntry('fuelio')).toBeNull();
		expect(fresh.models('ai.llm').map(e => e.capability)).toEqual(
			Array(fresh.models('ai.llm').length).fill('ai.llm')
		);
	});
});
