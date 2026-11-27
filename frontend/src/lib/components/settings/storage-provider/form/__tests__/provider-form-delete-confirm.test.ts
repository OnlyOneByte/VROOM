import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { UserProviderInfo } from '#lib/types/index.ts';
import { ApiError } from '#lib/utils/error-handling.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$app/env', () => ({ browser: true }));
vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/settings/providers/drive-1/edit') }
}));

const deleteProvider = vi.fn((_id: string, _options?: { force?: boolean }) => Promise.resolve());
vi.mock('#lib/services/provider-api.ts', async importOriginal => {
	const actual = await importOriginal<typeof import('#lib/services/provider-api.ts')>();
	return {
		...actual,
		providerApi: {
			getCatalog: async () =>
				(await import('#lib/stores/__tests__/provider-catalog-fixtures.ts')).PROVIDER_CATALOG,
			updateProvider: vi.fn(),
			createProvider: vi.fn(),
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

const ProviderForm = (await import('../ProviderForm.svelte')).default;

const STORED_PROVIDER: UserProviderInfo = {
	id: 'drive-1',
	domain: 'storage',
	providerType: 'google-drive',
	displayName: 'My Drive',
	status: 'active',
	config: { accountEmail: 'owner@example.com' },
	createdAt: '2026-01-01T00:00:00.000Z'
};

beforeEach(() => {
	deleteProvider.mockReset();
	deleteProvider.mockResolvedValue(undefined);
});

async function clickDeleteStorage(): Promise<void> {
	render(ProviderForm, {
		props: { providerId: 'drive-1', existingProvider: STORED_PROVIDER }
	});
	await fireEvent.click(await screen.findByRole('button', { name: 'Delete storage' }));
}

describe('ProviderForm Remove storage section asks before deleting', () => {
	test('on edit, Save changes comes before the Remove storage section', async () => {
		render(ProviderForm, {
			props: { providerId: 'drive-1', existingProvider: STORED_PROVIDER }
		});
		const save = await screen.findByRole('button', { name: 'Save changes' });
		const remove = screen.getByRole('region', { name: 'Remove storage' });

		expect(save.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	test('Delete storage opens a confirmation and deletes nothing yet', async () => {
		await clickDeleteStorage();
		expect(await screen.findByText('Delete My Drive?')).toBeInTheDocument();
		expect(screen.getByText(/Backups here stop/)).toBeInTheDocument();
		expect(deleteProvider).not.toHaveBeenCalled();
	});

	test('confirming deletes the provider', async () => {
		await clickDeleteStorage();
		await fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
		await waitFor(() => expect(deleteProvider).toHaveBeenCalledWith('drive-1', { force: false }));
	});

	test('cancelling deletes nothing', async () => {
		await clickDeleteStorage();
		await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
		expect(deleteProvider).not.toHaveBeenCalled();
	});

	test('photos stored only there get a second warning before a forced delete', async () => {
		deleteProvider.mockRejectedValueOnce(
			new ApiError('3 photos are stored only in this provider.', 409, { photosOnlyHere: 3 })
		);
		await clickDeleteStorage();
		await fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
		expect(
			await screen.findByText('3 photos are stored only in this provider.')
		).toBeInTheDocument();
		await fireEvent.click(await screen.findByRole('button', { name: 'Delete anyway' }));
		await waitFor(() =>
			expect(deleteProvider).toHaveBeenLastCalledWith('drive-1', { force: true })
		);
	});
});
