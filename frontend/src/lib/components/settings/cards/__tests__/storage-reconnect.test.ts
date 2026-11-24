import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { UserProviderInfo } from '#lib/types/index.ts';

const providers = vi.fn(() => Promise.resolve<UserProviderInfo[]>([]));
const startGoogleConnect = vi.fn();
const goto = vi.fn();

vi.mock('$app/navigation', () => ({ goto: (...args: unknown[]) => goto(...args) }));
vi.mock('../../storage-provider/use-google-oauth.svelte.ts', async importOriginal => ({
	...(await importOriginal<typeof import('../../storage-provider/use-google-oauth.svelte.ts')>()),
	startGoogleConnect: (opts: unknown) => startGoogleConnect(opts)
}));
vi.mock('#lib/services/photo-api.ts', () => ({
	orphanedPhotosApi: { count: () => Promise.resolve(0), remove: vi.fn() }
}));
vi.mock('#lib/services/provider-api.ts', async importOriginal => {
	const actual = await importOriginal<typeof import('#lib/services/provider-api.ts')>();
	return {
		...actual,
		providerApi: {
			getCatalog: async () =>
				(await import('#lib/stores/__tests__/provider-catalog-fixtures.ts')).PROVIDER_CATALOG,
			getProviders: () => providers(),
			getSyncStatus: () => Promise.resolve(null),
			backfillProvider: vi.fn(),
			testProvider: vi.fn()
		}
	};
});
vi.mock('#lib/services/settings-api.ts', () => ({
	settingsApi: {
		getSettings: () => Promise.resolve({ storageConfig: null, backupConfig: { providers: {} } }),
		updateSettings: vi.fn()
	}
}));
vi.mock('#lib/utils/sync/sync-manager.ts', () => ({
	fetchLastSyncTime: () => Promise.resolve(null)
}));

const StorageProvidersCard = (await import('../StorageProvidersCard.svelte')).default;

function row(providerType: string, displayName: string): UserProviderInfo {
	return {
		id: `prov-${providerType}`,
		domain: 'storage',
		providerType,
		displayName,
		status: 'needs_reauth',
		lastErrorCode: 'auth',
		config: providerType === 'google-drive' ? { accountEmail: 'ada@example.com' } : {},
		createdAt: '2026-01-01T00:00:00.000Z'
	};
}

beforeEach(async () => {
	vi.clearAllMocks();
	const { providerCatalog } = await import('#lib/stores/provider-catalog.svelte.ts');
	await providerCatalog.ensureLoaded();
});
afterEach(() => cleanup());

describe('Reconnect on a storage provider', () => {
	test('a Google provider signs in to Google again for that provider', async () => {
		providers.mockResolvedValue([row('google-drive', 'Family Drive')]);
		render(StorageProvidersCard, { props: {} });
		await fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
		expect(startGoogleConnect).toHaveBeenCalledWith(
			expect.objectContaining({
				isEditMode: true,
				providerId: 'prov-google-drive',
				existingEmail: 'ada@example.com',
				selectedType: 'google-drive'
			})
		);
		expect(goto).not.toHaveBeenCalled();
	});

	test('a key-based provider opens its edit page for new keys', async () => {
		providers.mockResolvedValue([row('s3', 'Office S3')]);
		render(StorageProvidersCard, { props: {} });
		await fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
		expect(startGoogleConnect).not.toHaveBeenCalled();
		expect(goto).toHaveBeenCalledWith(expect.stringContaining('/settings/providers/prov-s3/edit'));
	});
});
