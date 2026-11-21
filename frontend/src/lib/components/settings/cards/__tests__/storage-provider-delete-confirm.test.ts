import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { UserProviderInfo } from '#lib/types/index.ts';
import { ApiError } from '#lib/utils/error-handling.ts';

const deleteProvider = vi.fn((_id: string, _options?: { force?: boolean }) => Promise.resolve());
const drive: UserProviderInfo = {
	id: 'prov-1',
	domain: 'storage',
	providerType: 'google-drive',
	displayName: 'Family Drive',
	status: 'active',
	config: { accountEmail: 'demo@example.com' },
	createdAt: '2026-01-01T00:00:00.000Z'
};

vi.mock('#lib/services/provider-api.ts', async importOriginal => {
	const actual = await importOriginal<typeof import('#lib/services/provider-api.ts')>();
	return {
		...actual,
		providerApi: {
			getProviders: () => Promise.resolve([drive]),
			deleteProvider: (id: string, options?: { force?: boolean }) => deleteProvider(id, options)
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

beforeEach(() => {
	deleteProvider.mockReset();
	deleteProvider.mockResolvedValue(undefined);
});

async function clickDelete(): Promise<void> {
	render(StorageProvidersCard, { props: {} });
	await fireEvent.click(await screen.findByRole('button', { name: 'Delete Family Drive' }));
}

describe('deleting a storage provider asks first', () => {
	test('the trash button opens a confirmation and deletes nothing yet', async () => {
		await clickDelete();
		expect(await screen.findByText('Delete Family Drive?')).toBeInTheDocument();
		expect(screen.getByText(/Backups to this provider stop/)).toBeInTheDocument();
		expect(deleteProvider).not.toHaveBeenCalled();
	});

	test('confirming deletes the provider', async () => {
		await clickDelete();
		await fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
		await waitFor(() => expect(deleteProvider).toHaveBeenCalledWith('prov-1', { force: false }));
	});

	test('cancelling deletes nothing', async () => {
		await clickDelete();
		await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
		expect(deleteProvider).not.toHaveBeenCalled();
	});

	test('photos stored only there get a second, specific warning before a forced delete', async () => {
		deleteProvider.mockRejectedValueOnce(
			new ApiError('2 photos are stored only in this provider.', 409, { photosOnlyHere: 2 })
		);
		await clickDelete();
		await fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
		expect(
			await screen.findByText('2 photos are stored only in this provider.')
		).toBeInTheDocument();
		await fireEvent.click(await screen.findByRole('button', { name: 'Delete anyway' }));
		await waitFor(() => expect(deleteProvider).toHaveBeenLastCalledWith('prov-1', { force: true }));
	});
});
