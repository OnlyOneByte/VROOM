import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { UserProviderInfo } from '#lib/types/index.ts';
import { ApiError } from '#lib/utils/error-handling.ts';

const getSettings = vi.fn();
const updateSettings = vi.fn();
const showError = vi.fn();
const providers = vi.fn(() => Promise.resolve<UserProviderInfo[]>([]));
const deleteProvider = vi.fn((_id: string) => Promise.resolve());
const DRIVE: UserProviderInfo = {
	id: 'prov-1',
	domain: 'storage',
	providerType: 'google-drive',
	displayName: 'Family Drive',
	status: 'active',
	config: { accountEmail: 'demo@example.com' },
	createdAt: '2026-01-01T00:00:00.000Z'
};

vi.mock('#lib/services/photo-api.ts', () => ({
	orphanedPhotosApi: { count: () => Promise.resolve(0), remove: vi.fn() }
}));
vi.mock('#lib/services/provider-api.ts', async importOriginal => {
	const actual = await importOriginal<typeof import('#lib/services/provider-api.ts')>();
	return {
		...actual,
		providerApi: {
			getProviders: () => providers(),
			deleteProvider: (id: string) => deleteProvider(id)
		}
	};
});
vi.mock('#lib/services/settings-api.ts', () => ({
	settingsApi: {
		getSettings: () => getSettings(),
		updateSettings: (u: unknown) => updateSettings(u)
	}
}));
vi.mock('#lib/utils/sync/sync-manager.ts', () => ({
	fetchLastSyncTime: () => Promise.resolve(null)
}));
vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: { showSuccess: vi.fn(), showError: (m: string) => showError(m) }
}));

const StorageProvidersCard = (await import('../StorageProvidersCard.svelte')).default;
const { settingsStore } = await import('#lib/stores/settings.svelte.ts');
const SETTINGS = { storageConfig: null, backupConfig: { providers: {} } };

beforeEach(() => {
	settingsStore.reset();
	getSettings.mockReset();
	updateSettings.mockReset();
	showError.mockReset();
	providers.mockReset();
	providers.mockResolvedValue([]);
	deleteProvider.mockReset();
});

describe('Storage Providers card errors read as plain sentences', () => {
	test('a failed load names what failed, never shows the raw server text, and can be retried', async () => {
		getSettings.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce(SETTINGS);
		render(StorageProvidersCard, { props: {} });

		expect(await screen.findByText("Couldn't load your storage providers")).toBeInTheDocument();
		expect(
			screen.getByText('Something went wrong on our side. Try again in a moment.')
		).toBeInTheDocument();
		expect(screen.queryByText(/boom/)).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		expect(await screen.findByText('No storage provider connected')).toBeInTheDocument();
		expect(screen.queryByText("Couldn't load your storage providers")).toBeNull();
		await waitFor(() => expect(screen.getAllByRole('button')[0]).toHaveFocus());
	});

	test('a failed Retry keeps focus on the new Retry', async () => {
		getSettings.mockRejectedValue(new ApiError('boom', 500));
		render(StorageProvidersCard, { props: {} });

		await fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

		await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus());
		expect(getSettings).toHaveBeenCalledTimes(2);
	});

	test('a failed provider removal says what could not be done, with the reason', async () => {
		getSettings.mockResolvedValue(SETTINGS);
		providers.mockResolvedValue([DRIVE]);
		deleteProvider.mockRejectedValue(new ApiError('boom', 500));
		render(StorageProvidersCard, { props: {} });

		await fireEvent.click(await screen.findByRole('button', { name: 'Delete Family Drive' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

		await waitFor(() => expect(showError).toHaveBeenCalled());
		const message = showError.mock.calls[0]?.[0] as string;
		expect(message).toMatch(/^Couldn't remove the provider\. /);
		expect(message).not.toContain('boom');
	});

	test('a successful removal reloads the card in place, without the loading spinner', async () => {
		getSettings.mockResolvedValue(SETTINGS);
		providers.mockResolvedValueOnce([DRIVE]).mockReturnValueOnce(new Promise(() => {}));
		deleteProvider.mockResolvedValue(undefined);
		render(StorageProvidersCard, { props: {} });

		await fireEvent.click(await screen.findByRole('button', { name: 'Delete Family Drive' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

		await waitFor(() => expect(providers).toHaveBeenCalledTimes(2));
		expect(screen.getByText('Providers')).toBeInTheDocument();
		expect(screen.getByText('Family Drive')).toBeInTheDocument();
	});
});

describe('Storage Providers card reads and writes settings through the store', () => {
	test('it reuses the loaded settings and a backup toggle updates the store', async () => {
		const enabled = {
			providers: { 'prov-1': { enabled: true, folderPath: 'Backups', retentionCount: 10 } }
		};
		getSettings.mockResolvedValue(SETTINGS);
		updateSettings.mockResolvedValue({ ...SETTINGS, backupConfig: enabled });
		providers.mockResolvedValue([DRIVE]);
		await settingsStore.load();
		render(StorageProvidersCard, { props: {} });

		await fireEvent.click(await screen.findByRole('switch', { name: 'ZIP backup' }));

		await waitFor(() => expect(settingsStore.settings?.backupConfig).toEqual(enabled));
		expect(updateSettings).toHaveBeenCalledWith({ backupConfig: enabled });
		expect(screen.getByRole('switch', { name: 'ZIP backup' })).toHaveAttribute(
			'aria-checked',
			'true'
		);
		expect(getSettings).toHaveBeenCalledTimes(1);
	});
});
