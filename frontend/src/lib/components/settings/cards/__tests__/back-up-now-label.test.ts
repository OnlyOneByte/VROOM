import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, test, vi } from 'vitest';
import type { UserProviderInfo } from '#lib/types/index.ts';

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
			getProviders: () => Promise.resolve([DRIVE]),
			getSyncStatus: () => Promise.resolve(null),
			backfillProvider: vi.fn()
		}
	};
});
vi.mock('#lib/services/settings-api.ts', () => ({
	settingsApi: {
		getSettings: () =>
			Promise.resolve({
				storageConfig: null,
				backupConfig: { providers: { 'prov-1': { enabled: true, folderPath: '/VROOM' } } }
			}),
		updateSettings: vi.fn()
	}
}));
vi.mock('#lib/utils/sync/sync-manager.ts', () => ({
	fetchLastSyncTime: () => Promise.resolve(null)
}));

const StorageProvidersCard = (await import('../StorageProvidersCard.svelte')).default;
const BackupDialog = (await import('../../storage-provider/backup/BackupDialog.svelte')).default;

describe('Back up now is one verb-form name for the cloud backup action', () => {
	test('the Back up now and restore button is Back up now', async () => {
		const onBackupNow = vi.fn();
		render(StorageProvidersCard, { props: { onBackupNow } });

		await fireEvent.click(await screen.findByRole('button', { name: 'Back up now' }));
		expect(onBackupNow).toHaveBeenCalledOnce();
		expect(screen.queryByText(/Backup to Cloud|Backup Now|Back Up Now/)).toBeNull();
	});

	test('the dialog title is Back up now and its confirm button names how many providers it reaches', async () => {
		const onSync = vi.fn();
		render(BackupDialog, {
			props: {
				open: true,
				backupProvidersEnabled: true,
				providerNames: ['Family Drive', 'Office S3'],
				onSync
			}
		});

		expect(await screen.findByRole('heading', { name: 'Back up now' })).toBeInTheDocument();
		expect(screen.getByRole('list', { name: 'Backups go to' })).toHaveTextContent('Family Drive');
		await fireEvent.click(screen.getByRole('button', { name: 'Back up to 2 providers' }));
		expect(onSync).toHaveBeenCalledOnce();
		expect(screen.queryByText(/Backup Now|Back Up Now/)).toBeNull();
	});

	test('one provider reads in the singular, and none falls back to Back up now', async () => {
		const { unmount } = render(BackupDialog, {
			props: {
				open: true,
				backupProvidersEnabled: true,
				providerNames: ['Family Drive'],
				onSync: vi.fn()
			}
		});
		expect(await screen.findByRole('button', { name: 'Back up to 1 provider' })).toBeEnabled();
		unmount();

		render(BackupDialog, { props: { open: true, backupProvidersEnabled: false, onSync: vi.fn() } });
		expect(await screen.findByRole('button', { name: 'Back up now' })).toBeDisabled();
		expect(screen.getByText('Turn on backups for a storage provider first.')).toBeInTheDocument();
	});
});
