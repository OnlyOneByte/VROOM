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
				(
					await import('#lib/stores/__tests__/provider-catalog-fixtures.ts')
				).PROVIDER_CATALOG.filter(
					entry => entry.capability !== 'storage' || entry.id === 'google-drive'
				),
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

	test('on edit, Save changes sits in a bar that sticks to the bottom below lg', async () => {
		render(ProviderForm, {
			props: { providerId: 'drive-1', existingProvider: STORED_PROVIDER }
		});
		const save = await screen.findByRole('button', { name: 'Save changes' });

		const bar = save.closest('[data-slot="form-action-bar"]');
		expect(bar).toHaveClass('sticky', 'bottom-0', 'lg:static', 'short:static');
	});

	test('Delete storage opens a confirmation and deletes nothing yet', async () => {
		await clickDeleteStorage();
		expect(await screen.findByText('Delete My Drive?')).toBeInTheDocument();
		expect(
			screen.getByText(
				"VROOM stops backing up here and removes this storage's settings. Your files stay in the storage itself."
			)
		).toBeInTheDocument();
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
			new ApiError('3 photos are stored only in this storage.', 409, { photosOnlyHere: 3 })
		);
		await clickDeleteStorage();
		await fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
		expect(
			await screen.findByText('3 photos are stored only in this storage.')
		).toBeInTheDocument();
		await fireEvent.click(await screen.findByRole('button', { name: 'Delete anyway' }));
		await waitFor(() =>
			expect(deleteProvider).toHaveBeenLastCalledWith('drive-1', { force: true })
		);
	});
});

describe('ProviderForm with a single storage type on offer', () => {
	test('Add storage picks that type, so the form shows at once with no hint', async () => {
		render(ProviderForm, { props: {} });

		const drive = await screen.findByRole('button', { name: /Google Drive/ });
		await waitFor(() => expect(drive).toHaveAttribute('aria-pressed', 'true'));
		expect(screen.getByLabelText('Name')).toBeInTheDocument();
		expect(screen.queryByText('Choose a type to continue.')).toBeNull();
		expect(
			screen.getByText('Connect your Google account to use Google Drive for photos and backups')
		).toBeInTheDocument();
	});
});
