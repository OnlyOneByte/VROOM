import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { UserProviderInfo, UserSettings } from '#lib/types/index.ts';
import { fakeSettingsState, settingsStoreFake } from './settings-store-fake.svelte.ts';
import { toast } from 'svelte-sonner';
import { ApiError, SERVER_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';

const { showError, showSuccess, getProviders, fetchLastSyncTime } = vi.hoisted(() => ({
	showError: vi.fn<(message: string) => void>(),
	showSuccess: vi.fn<(message: string) => void>(),
	getProviders: vi.fn<(domain?: string) => Promise<UserProviderInfo[]>>(),
	fetchLastSyncTime: vi.fn<() => Promise<void>>()
}));

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/stores/settings.svelte.ts', async () => ({
	settingsStore: (await import('./settings-store-fake.svelte.ts')).settingsStoreFake
}));
vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: {
		showError: (message: string) => showError(message),
		showSuccess: (message: string) => showSuccess(message)
	}
}));
vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: { getProviders: (domain?: string) => getProviders(domain) }
}));
vi.mock('#lib/utils/sync/sync-manager.ts', () => ({
	fetchLastSyncTime: () => fetchLastSyncTime()
}));
vi.mock('svelte-sonner', () => ({
	toast: {
		loading: vi.fn(() => 'toast-1'),
		error: vi.fn(),
		info: vi.fn(),
		success: vi.fn(),
		warning: vi.fn(),
		dismiss: vi.fn()
	}
}));

const { stub } = vi.hoisted(() => ({
	stub: async () => ({ default: (await import('./SettingsChildStub.svelte')).default })
}));
vi.mock('#lib/components/settings/cards/StorageProvidersCard.svelte', stub);
vi.mock('#lib/components/settings/storage-provider/backup/BackupDialog.svelte', stub);
vi.mock('#lib/components/settings/storage-provider/backup/RestoreDialog.svelte', stub);

const StoragePage = (await import('../storage/+page.svelte')).default;

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
	return {
		id: 's1',
		userId: 'u1',
		unitPreferences: { distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' },
		currencyUnit: 'EUR',
		autoBackupEnabled: true,
		backupFrequency: 'daily',
		syncInactivityMinutes: 15,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

function loadsWith(settings: UserSettings) {
	settingsStoreFake.load.mockImplementation(async () => {
		fakeSettingsState.settings = settings;
		fakeSettingsState.isLoading = false;
		fakeSettingsState.error = null;
	});
}

async function mount() {
	const result = render(StoragePage);
	await settle();
	return result;
}

function inactivity(): HTMLInputElement {
	return screen.getByRole('spinbutton', { name: 'stub inactivity' }) as HTMLInputElement;
}

async function changeInactivity(value: string) {
	await fireEvent.input(inactivity(), { target: { value } });
	await fireEvent.change(inactivity());
	await settle();
}

beforeEach(() => {
	vi.clearAllMocks();
	fakeSettingsState.settings = null;
	fakeSettingsState.isLoading = false;
	fakeSettingsState.error = null;
	loadsWith(makeSettings());
	settingsStoreFake.update.mockImplementation(async updates => {
		const next = { ...(fakeSettingsState.settings ?? makeSettings()), ...updates } as UserSettings;
		fakeSettingsState.settings = next;
		return next;
	});
	getProviders.mockResolvedValue([]);
	fetchLastSyncTime.mockResolvedValue();
});

afterEach(() => {
	cleanup();
});

describe('Backups and storage page', () => {
	test('loads settings and storage providers, and points to Your data for the ZIP export', async () => {
		await mount();
		expect(settingsStoreFake.load).toHaveBeenCalledTimes(1);
		expect(getProviders).toHaveBeenCalledWith('storage');
		expect(screen.getByRole('link', { name: 'Back to Settings' })).toHaveAttribute(
			'href',
			'/settings'
		);
		expect(
			screen.getByRole('link', { name: 'Export all your data from Settings' })
		).toHaveAttribute('href', '/settings#settings-data');
		expect(screen.queryByRole('button', { name: /Download|Export/ })).toBeNull();
	});

	test('a load failure shows the error and retry reloads settings and providers', async () => {
		settingsStoreFake.load.mockImplementationOnce(async () => {
			fakeSettingsState.error = SERVER_FAILURE_MESSAGE;
		});
		await mount();
		expect(screen.getByText("Couldn't load your storage settings")).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: /Retry|Try again/ }));
		await settle();
		expect(settingsStoreFake.load).toHaveBeenCalledTimes(2);
		expect(getProviders).toHaveBeenCalledTimes(2);
		expect(inactivity()).toBeInTheDocument();
	});

	test('a storage-provider load failure still renders the page', async () => {
		getProviders.mockRejectedValue(new Error('offline'));
		await mount();
		expect(inactivity()).toHaveValue(15);
	});

	test('a zero inactivity window falls back to five minutes', async () => {
		loadsWith(makeSettings({ syncInactivityMinutes: 0 }));
		await mount();
		expect(inactivity()).toHaveValue(5);
	});

	test('changing the inactivity window saves just that window', async () => {
		await mount();
		await changeInactivity('30');
		expect(settingsStoreFake.update).toHaveBeenCalledWith({ syncInactivityMinutes: 30 });
		expect(showSuccess).toHaveBeenCalledWith('Backup timing saved');
	});

	test('a failed inactivity save says so and puts the saved value back', async () => {
		settingsStoreFake.update.mockRejectedValue(new ApiError('SQLITE_BUSY', 500));
		await mount();
		await changeInactivity('30');
		expect(showError).toHaveBeenCalledWith(`Couldn't save settings. ${SERVER_FAILURE_MESSAGE}`);
		expect(inactivity()).toHaveValue(15);
	});

	test('sync-on-inactivity follows whether any provider has backup or sheets sync on', async () => {
		loadsWith(
			makeSettings({
				syncOnInactivity: false,
				backupConfig: {
					providers: {
						p1: { enabled: false, folderPath: '/', retentionCount: 5, sheetsSyncEnabled: true }
					}
				}
			})
		);
		await mount();
		expect(settingsStoreFake.update).toHaveBeenCalledWith({ syncOnInactivity: true });
		expect(settingsStoreFake.update).toHaveBeenCalledTimes(1);
		expect(showSuccess).not.toHaveBeenCalled();
	});

	test.each([
		['already on, no provider syncing', undefined],
		['off, no provider syncing', false]
	])('sync-on-inactivity is left alone when %s', async (_case, stored) => {
		loadsWith(makeSettings({ syncOnInactivity: stored }));
		await mount();
		expect(settingsStoreFake.update).not.toHaveBeenCalled();
	});
});

describe('Backups and storage page backups', () => {
	async function backUpNow() {
		await fireEvent.click(screen.getByRole('button', { name: 'stub backup now' }));
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'stub sync' }));
		await settle();
	}

	function orchestratorResult(
		outcome: 'success' | 'partial' | 'failed' | 'noop',
		results: Record<string, boolean>,
		failedProviders: string[] = [],
		unusable: string[] = []
	) {
		return {
			timestamp: '2026-11-23T00:00:00.000Z',
			outcome,
			failedProviders,
			results: Object.fromEntries(
				Object.entries(results).map(([id, success]) => [
					id,
					{ success, capabilities: {}, ...(unusable.includes(id) && { unusable: true }) }
				])
			)
		};
	}

	test('a successful run ends the loading toast with how many providers it reached', async () => {
		settingsStoreFake.executeSync.mockResolvedValue(
			orchestratorResult('success', { p1: true, p2: true })
		);
		await mount();
		await backUpNow();
		expect(toast.success).toHaveBeenCalledWith('Backed up to 2 places', { id: 'toast-1' });
	});

	test('a successful run whose old-backup cleanup failed warns and names the provider', async () => {
		getProviders.mockResolvedValue([
			{ id: 'p1', displayName: 'Family Drive' } as UserProviderInfo,
			{ id: 'p2', displayName: 'Office S3' } as UserProviderInfo
		]);
		const result = orchestratorResult('success', { p1: true, p2: true });
		result.results['p2'] = {
			success: true,
			capabilities: {
				zip: {
					success: true,
					warning:
						"Old backups couldn't be removed. VROOM needs permission to list and delete files there."
				}
			}
		} as never;
		settingsStoreFake.executeSync.mockResolvedValue(result);
		await mount();
		await backUpNow();
		expect(toast.warning).toHaveBeenCalledWith(
			"Backed up to 2 places. Office S3: Old backups couldn't be removed. VROOM needs permission to list and delete files there.",
			{ id: 'toast-1' }
		);
		expect(toast.success).not.toHaveBeenCalled();
	});

	test('when cleanup failed on two providers, the warning names both and still gives the reason', async () => {
		getProviders.mockResolvedValue([
			{ id: 'p1', displayName: 'Family Drive' } as UserProviderInfo,
			{ id: 'p2', displayName: 'Office S3' } as UserProviderInfo
		]);
		const result = orchestratorResult('success', { p1: true, p2: true });
		const warned = {
			success: true,
			capabilities: {
				zip: {
					success: true,
					warning:
						"Old backups couldn't be removed. VROOM needs permission to list and delete files there."
				}
			}
		} as never;
		result.results['p1'] = warned;
		result.results['p2'] = warned;
		settingsStoreFake.executeSync.mockResolvedValue(result);
		await mount();
		await backUpNow();
		expect(toast.warning).toHaveBeenCalledWith(
			"Backed up to 2 places. Family Drive and Office S3: Old backups couldn't be removed. VROOM needs permission to list and delete files there.",
			{ id: 'toast-1' }
		);
	});

	test('a partial run names the failed provider and says the rest succeeded', async () => {
		getProviders.mockResolvedValue([
			{ id: 'p1', displayName: 'Family Drive' } as UserProviderInfo,
			{ id: 'p2', displayName: 'Office S3' } as UserProviderInfo
		]);
		settingsStoreFake.executeSync.mockResolvedValue(
			orchestratorResult('partial', { p1: true, p2: false }, ['p2'])
		);
		await mount();
		await backUpNow();
		expect(toast.warning).toHaveBeenCalledWith(
			'Backed up to 1 place. Office S3 failed. Check it under Connected, then try again.',
			{ id: 'toast-1' }
		);
		expect(toast.error).not.toHaveBeenCalled();
	});

	test('a run with nothing to back up ends the spinner and says why', async () => {
		settingsStoreFake.executeSync.mockResolvedValue(orchestratorResult('noop', {}));
		await mount();
		await backUpNow();
		expect(toast.info).toHaveBeenCalledWith('Nothing to back up: backups are off for all storage', {
			id: 'toast-1'
		});
	});

	test('a failed run reported in the body ends the toast with the failed providers', async () => {
		settingsStoreFake.executeSync.mockResolvedValue(
			orchestratorResult('failed', { p1: false }, ['p1'])
		);
		await mount();
		await backUpNow();
		expect(toast.error).toHaveBeenCalledWith(
			"Couldn't back up. p1 failed. Check it under Connected, then try again.",
			{ id: 'toast-1' }
		);
	});

	test('a partial run lists three failed providers as a sentence', async () => {
		getProviders.mockResolvedValue([
			{ id: 'p1', displayName: 'Family Drive' } as UserProviderInfo,
			{ id: 'p2', displayName: 'Office S3' } as UserProviderInfo,
			{ id: 'p3', displayName: 'Home NAS' } as UserProviderInfo,
			{ id: 'p4', displayName: 'Cabin S3' } as UserProviderInfo
		]);
		settingsStoreFake.executeSync.mockResolvedValue(
			orchestratorResult('partial', { p1: true, p2: false, p3: false, p4: false }, [
				'p2',
				'p3',
				'p4'
			])
		);
		await mount();
		await backUpNow();
		expect(toast.warning).toHaveBeenCalledWith(
			'Backed up to 1 place. Office S3, Home NAS, and Cabin S3 failed. Check them under Connected, then try again.',
			{ id: 'toast-1' }
		);
	});

	test('a partial run joins two failed providers with "and" next to an unusable one', async () => {
		getProviders.mockResolvedValue([
			{ id: 'p1', displayName: 'Family Drive' } as UserProviderInfo,
			{ id: 'p2', displayName: 'Office S3' } as UserProviderInfo,
			{ id: 'p3', displayName: 'Home NAS' } as UserProviderInfo,
			{ id: 'p4', displayName: 'Old Drive' } as UserProviderInfo
		]);
		settingsStoreFake.executeSync.mockResolvedValue(
			orchestratorResult(
				'partial',
				{ p1: true, p2: false, p3: false, p4: false },
				['p2', 'p3', 'p4'],
				['p4']
			)
		);
		await mount();
		await backUpNow();
		expect(toast.warning).toHaveBeenCalledWith(
			"Backed up to 1 place. Office S3 and Home NAS failed and Old Drive can't be used. Check them under Connected, then try again.",
			{ id: 'toast-1' }
		);
	});

	test('a partial run names a provider that failed and one that cannot be used, with a next step', async () => {
		getProviders.mockResolvedValue([
			{ id: 'p1', displayName: 'Family Drive' } as UserProviderInfo,
			{ id: 'p2', displayName: 'Office S3' } as UserProviderInfo,
			{ id: 'p3', displayName: 'Old Drive' } as UserProviderInfo
		]);
		settingsStoreFake.executeSync.mockResolvedValue(
			orchestratorResult('partial', { p1: true, p2: false, p3: false }, ['p2', 'p3'], ['p3'])
		);
		await mount();
		await backUpNow();
		expect(toast.warning).toHaveBeenCalledWith(
			"Backed up to 1 place. Office S3 failed and Old Drive can't be used. Check them under Connected, then try again.",
			{ id: 'toast-1' }
		);
	});

	test.each([
		[
			{ p1: { success: false, capabilities: {} } },
			"Couldn't back up. Family Drive failed. Check it under Connected, then try again."
		],
		[
			{ p1: { success: false, unusable: true, capabilities: {} } },
			"Couldn't back up. Family Drive can't be used. Reconnect it under Connected, then try again."
		]
	])(
		'an all-failed 502 names the provider from the error details (%o)',
		async (results, message) => {
			getProviders.mockResolvedValue([
				{ id: 'p1', displayName: 'Family Drive' } as UserProviderInfo
			]);
			settingsStoreFake.executeSync.mockRejectedValue(
				new ApiError(
					'All backup providers failed',
					502,
					{ failedProviders: ['p1'], results },
					'BACKUP_FAILED'
				)
			);
			await mount();
			await backUpNow();
			expect(toast.dismiss).toHaveBeenCalled();
			expect(showError).toHaveBeenCalledWith(message);
			expect(screen.queryByText(/backups are off for all storage/)).toBeNull();
		}
	);

	test.each([
		[
			new ApiError('A backup is already in progress', 409, undefined, 'BACKUP_IN_PROGRESS'),
			"Couldn't back up. A backup is already running. Try again once it finishes."
		],
		[
			new ApiError('ENOSPC: no space left on device', 500),
			`Couldn't back up. ${SERVER_FAILURE_MESSAGE}`
		]
	])('a failed backup explains %s in a plain sentence', async (error, message) => {
		settingsStoreFake.executeSync.mockRejectedValue(error);
		await mount();
		await fireEvent.click(screen.getByRole('button', { name: 'stub backup now' }));
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'stub sync' }));
		await settle();
		expect(toast.dismiss).toHaveBeenCalled();
		expect(showError).toHaveBeenCalledWith(message);
	});

	test.each([
		['stub backup now', 'stub sync'],
		['stub restore', 'stub restore']
	])('the dialog behind %s mounts only once it is opened', async (trigger, dialogButton) => {
		await mount();
		const before = screen.queryAllByRole('button', { name: dialogButton }).length;
		expect(screen.queryByTestId('stub-open')).toBeNull();

		await fireEvent.click(screen.getAllByRole('button', { name: trigger })[0]!);
		await settle();
		expect(screen.getAllByRole('button', { name: dialogButton })).toHaveLength(before + 1);
		expect(screen.getByTestId('stub-open')).toBeInTheDocument();
	});
});
