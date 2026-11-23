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

describe('Back Up Now is one verb-form name for the cloud backup action', () => {
	test('the Storage & Backup button is Back Up Now', async () => {
		const onBackupNow = vi.fn();
		render(StorageProvidersCard, { props: { onBackupNow } });

		await fireEvent.click(await screen.findByRole('button', { name: 'Back Up Now' }));
		expect(onBackupNow).toHaveBeenCalledOnce();
		expect(screen.queryByText(/Backup to Cloud|Backup Now/)).toBeNull();
	});

	test('the dialog title and its confirm button are Back Up Now', async () => {
		const onSync = vi.fn();
		render(BackupDialog, { props: { open: true, backupProvidersEnabled: true, onSync } });

		expect(await screen.findByRole('heading', { name: 'Back Up Now' })).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Back Up Now' }));
		expect(onSync).toHaveBeenCalledOnce();
		expect(screen.queryByText(/Backup Now/)).toBeNull();
	});
});
