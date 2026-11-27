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

const DRIVE_ENTRY = {
	id: 'google-drive',
	label: 'Google Drive',
	shortLabel: 'Drive',
	description: 'Google Drive',
	scope: 'user',
	connect: 'oauth',
	fields: [],
	secrets: [],
	capability: 'storage',
	features: {
		photoOnly: false,
		backupSheets: true,
		defaultFolders: {
			vehicle_photos: 'Vehicle',
			expense_receipts: 'Receipts',
			insurance_docs: 'Insurance',
			odometer_readings: 'Odometer'
		},
		defaultPhotoRootPath: 'Photos'
	}
};

const settingsState = vi.hoisted(() => ({
	backupConfig: { providers: { 'prov-1': { enabled: true, folderPath: '/VROOM' } } } as {
		providers: Record<string, { enabled: boolean; folderPath: string }>;
	}
}));

vi.mock('#lib/services/photo-api.ts', () => ({
	orphanedPhotosApi: { count: () => Promise.resolve(0), remove: vi.fn() }
}));
vi.mock('#lib/services/provider-api.ts', async importOriginal => {
	const actual = await importOriginal<typeof import('#lib/services/provider-api.ts')>();
	return {
		...actual,
		providerApi: {
			getProviders: () => Promise.resolve([DRIVE]),
			getCatalog: () => Promise.resolve([DRIVE_ENTRY]),
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
				backupConfig: settingsState.backupConfig
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
				providers: [
					{ id: 'p1', displayName: 'Family Drive', savedOn: true, status: 'Backups on' },
					{ id: 'p2', displayName: 'Office S3', savedOn: true, status: 'Backups on' }
				],
				onSync
			}
		});

		expect(await screen.findByRole('heading', { name: 'Back up now' })).toBeInTheDocument();
		expect(screen.getByRole('list', { name: 'Backups go to' })).toHaveTextContent('Family Drive');
		await fireEvent.click(screen.getByRole('button', { name: 'Back up to 2 providers' }));
		expect(onSync).toHaveBeenCalledExactlyOnceWith(undefined);
		expect(screen.queryByText(/Backup Now|Back Up Now/)).toBeNull();
	});

	test('one provider reads in the singular, and none falls back to Back up now', async () => {
		const { unmount } = render(BackupDialog, {
			props: {
				open: true,
				providers: [{ id: 'p1', displayName: 'Family Drive', savedOn: true, status: 'Backups on' }],
				onSync: vi.fn()
			}
		});
		expect(await screen.findByRole('button', { name: 'Back up to 1 provider' })).toBeEnabled();
		unmount();

		render(BackupDialog, { props: { open: true, onSync: vi.fn() } });
		expect(await screen.findByRole('button', { name: 'Back up now' })).toBeDisabled();
		expect(
			screen.getByText('Connect a storage provider that can hold backups first.')
		).toBeInTheDocument();
	});

	test('two providers with the same name both show, without a duplicate-key crash', async () => {
		render(BackupDialog, {
			props: {
				open: true,
				providers: [
					{ id: 'p1', displayName: 'Google Drive', savedOn: true, status: 'Backups on' },
					{ id: 'p2', displayName: 'Google Drive', savedOn: true, status: 'Backups on' }
				],
				onSync: vi.fn()
			}
		});
		const list = await screen.findByRole('list', { name: 'Backups go to' });
		expect(list.querySelectorAll('li')).toHaveLength(2);
		expect(screen.getByRole('button', { name: 'Back up to 2 providers' })).toBeEnabled();
	});

	test('switches start from the saved setting and choosing a subset sends only those ids', async () => {
		const onSync = vi.fn();
		render(BackupDialog, {
			props: {
				open: true,
				providers: [
					{ id: 'p1', displayName: 'Family Drive', savedOn: true, status: 'Backups on' },
					{ id: 'p2', displayName: 'Office S3', savedOn: false, status: 'Backups off' }
				],
				onSync
			}
		});

		const drive = await screen.findByRole('switch', { name: 'Back up to Family Drive' });
		const s3 = screen.getByRole('switch', { name: 'Back up to Office S3' });
		expect(drive).toHaveAttribute('aria-checked', 'true');
		expect(s3).toHaveAttribute('aria-checked', 'false');
		expect(screen.getByText('Backups off')).toBeInTheDocument();

		await fireEvent.click(drive);
		await fireEvent.click(s3);
		await fireEvent.click(screen.getByRole('button', { name: 'Back up to 1 provider' }));
		expect(onSync).toHaveBeenCalledExactlyOnceWith(['p2']);
	});

	test('turning every switch off disables the confirm button', async () => {
		render(BackupDialog, {
			props: {
				open: true,
				providers: [{ id: 'p1', displayName: 'Family Drive', savedOn: true, status: 'Backups on' }],
				onSync: vi.fn()
			}
		});

		await fireEvent.click(await screen.findByRole('switch', { name: 'Back up to Family Drive' }));
		expect(screen.getByRole('button', { name: 'Back up now' })).toBeDisabled();
	});

	test('with no provider backing up, Back up now still offers a one-off backup to a capable provider', async () => {
		const { providerCatalog } = await import('#lib/stores/provider-catalog.svelte.ts');
		const { settingsStore } = await import('#lib/stores/settings.svelte.ts');
		settingsState.backupConfig = { providers: {} };
		await providerCatalog.ensureLoaded();
		await settingsStore.load();
		try {
			const onBackupNow = vi.fn();
			render(StorageProvidersCard, { props: { onBackupNow } });

			expect(
				await screen.findByText(
					'No provider has backups on. You can still send one backup to a provider you choose.'
				)
			).toBeInTheDocument();
			await fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));
			expect(onBackupNow).toHaveBeenCalledOnce();
		} finally {
			settingsState.backupConfig = {
				providers: { 'prov-1': { enabled: true, folderPath: '/VROOM' } }
			};
		}
	});
});
