import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { hasPendingSave } from '#lib/utils/pending-saves.ts';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { User, UserProviderInfo, UserSettings } from '#lib/types/index.ts';
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
	toast: { loading: vi.fn(), error: vi.fn(), info: vi.fn(), success: vi.fn(), dismiss: vi.fn() }
}));

const { stub } = vi.hoisted(() => ({
	stub: async () => ({ default: (await import('./SettingsChildStub.svelte')).default })
}));
vi.mock('#lib/components/settings/cards/UnitPreferencesCard.svelte', stub);
vi.mock('#lib/components/settings/cards/ThemeCard.svelte', stub);
vi.mock('#lib/components/settings/cards/ThemePickerCard.svelte', stub);
vi.mock('#lib/components/settings/cards/PwaInstallCard.svelte', stub);
vi.mock('#lib/components/settings/cards/PushNotificationsCard.svelte', stub);
vi.mock('#lib/components/settings/cards/StorageProvidersCard.svelte', stub);
vi.mock('#lib/components/settings/cards/ModelProvidersCard.svelte', stub);
vi.mock('#lib/components/settings/cards/MigrateFromTrackerCard.svelte', stub);
vi.mock('#lib/components/settings/storage-provider/backup/BackupDialog.svelte', stub);
vi.mock('#lib/components/settings/storage-provider/backup/RestoreDialog.svelte', stub);

const { authStore } = await import('#lib/stores/auth.svelte.ts');
const SettingsPage = (await import('../+page.svelte')).default;

const USER: User = {
	id: 'u1',
	email: 'ada@example.com',
	displayName: 'Ada Lovelace',
	createdAt: '2024-03-15T12:00:00.000Z',
	updatedAt: '2024-03-15T12:00:00.000Z'
};

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
	const result = render(SettingsPage);
	await settle();
	return result;
}

function stubInput(name: string): HTMLInputElement {
	return screen.getByRole(name === 'stub inactivity' ? 'spinbutton' : 'textbox', {
		name
	}) as HTMLInputElement;
}

async function change(name: string, value: string) {
	const input = stubInput(name);
	await fireEvent.input(input, { target: { value } });
	await fireEvent.change(input);
	await settle();
}

beforeEach(() => {
	vi.clearAllMocks();
	fakeSettingsState.settings = null;
	fakeSettingsState.isLoading = false;
	fakeSettingsState.error = null;
	authStore.setUser({ ...USER });
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
	authStore.clearUser();
});

describe('Settings page loading', () => {
	test('loads settings and storage providers on mount', async () => {
		await mount();
		expect(settingsStoreFake.load).toHaveBeenCalledTimes(1);
		expect(getProviders).toHaveBeenCalledWith('storage');
	});

	test('shows a spinner while loading', async () => {
		settingsStoreFake.load.mockImplementation(async () => {
			fakeSettingsState.isLoading = true;
		});
		const { container } = await mount();
		expect(container.querySelector('.animate-spin')).not.toBeNull();
	});

	test('has no Save Settings button: every preference saves on change', async () => {
		await mount();
		expect(screen.getByTestId('stub-model-llm')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
	});

	test('the cards mount once settings exist and stay mounted while settings reload', async () => {
		let finish = () => {};
		settingsStoreFake.load.mockImplementation(
			() =>
				new Promise<void>(resolve => {
					finish = () => {
						fakeSettingsState.settings = makeSettings();
						resolve();
					};
				})
		);
		await mount();
		expect(screen.queryByTestId('stub-model-llm')).toBeNull();

		finish();
		await settle();
		const card = screen.getByTestId('stub-model-llm');

		fakeSettingsState.isLoading = true;
		await settle();
		expect(screen.getByTestId('stub-model-llm')).toBe(card);
	});

	test('a load failure shows the error and retry reloads everything', async () => {
		settingsStoreFake.load.mockImplementationOnce(async () => {
			fakeSettingsState.error = SERVER_FAILURE_MESSAGE;
		});
		await mount();
		expect(screen.getByText("Couldn't load settings")).toBeInTheDocument();
		expect(screen.getByText(SERVER_FAILURE_MESSAGE)).toBeInTheDocument();
		expect(screen.queryByTestId('stub-model-llm')).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await settle();
		expect(settingsStoreFake.load).toHaveBeenCalledTimes(2);
		expect(getProviders).toHaveBeenCalledTimes(2);
		expect(screen.queryByText("Couldn't load settings")).toBeNull();
		expect(screen.getByTestId('stub-model-llm')).toBeInTheDocument();
	});

	test('a storage-provider load failure still renders the page', async () => {
		getProviders.mockRejectedValue(new Error('offline'));
		await mount();
		expect(screen.getByTestId('stub-model-llm')).toBeInTheDocument();
	});

	test('links to the profile with the user initials, name and email', async () => {
		await mount();
		const link = screen.getByRole('link');
		expect(link).toHaveAttribute('href', '/profile');
		expect(link).toHaveTextContent('AL');
		expect(link).toHaveTextContent('Ada Lovelace');
		expect(link).toHaveTextContent('ada@example.com');
	});

	test('the profile link falls back to generic text without a user', async () => {
		authStore.clearUser();
		await mount();
		const link = screen.getByRole('link');
		expect(link).toHaveTextContent('?');
		expect(link).toHaveTextContent('User');
		expect(link).toHaveTextContent('Account & profile settings');
	});

	test('renders both AI provider cards', async () => {
		await mount();
		expect(screen.getByTestId('stub-model-vlm')).toBeInTheDocument();
		expect(screen.getByTestId('stub-model-llm')).toBeInTheDocument();
	});
});

describe('Settings page preferences', () => {
	test('initialises the unit and currency pickers from saved settings', async () => {
		await mount();
		expect(stubInput('stub distance')).toHaveValue('kilometers');
		expect(stubInput('stub volume')).toHaveValue('liters');
		expect(stubInput('stub currency')).toHaveValue('EUR');
		expect(screen.getByTestId('stub-charge')).toHaveTextContent('kwh');
		expect(stubInput('stub inactivity')).toHaveValue(15);
	});

	test('a zero inactivity window falls back to five minutes', async () => {
		loadsWith(makeSettings({ syncInactivityMinutes: 0 }));
		await mount();
		expect(stubInput('stub inactivity')).toHaveValue(5);
	});

	test('changing a unit saves just the units and confirms with a toast', async () => {
		await mount();
		await change('stub distance', 'miles');

		expect(settingsStoreFake.update).toHaveBeenCalledWith({
			unitPreferences: { distanceUnit: 'miles', volumeUnit: 'liters', chargeUnit: 'kwh' }
		});
		expect(showSuccess).toHaveBeenCalledWith('Units saved');
		expect(fetchLastSyncTime).toHaveBeenCalledTimes(1);
	});

	test('changing the currency saves just the currency', async () => {
		await mount();
		await change('stub currency', 'GBP');
		expect(settingsStoreFake.update).toHaveBeenCalledWith({ currencyUnit: 'GBP' });
		expect(showSuccess).toHaveBeenCalledWith('Currency saved');
	});

	test('changing the inactivity window saves just that window', async () => {
		await mount();
		await change('stub inactivity', '30');
		expect(settingsStoreFake.update).toHaveBeenCalledWith({ syncInactivityMinutes: 30 });
		expect(showSuccess).toHaveBeenCalledWith('Backup timing saved');
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

	test('overlapping saves keep the newer pick on screen and reload once both finish', async () => {
		const pending: Array<() => void> = [];
		settingsStoreFake.update.mockImplementation(
			updates =>
				new Promise(resolve => {
					pending.push(() => {
						const next = { ...makeSettings(), ...updates } as UserSettings;
						fakeSettingsState.settings = next;
						resolve(next);
					});
				})
		);
		await mount();
		await change('stub distance', 'miles');
		await change('stub volume', 'gallons_uk');
		expect(settingsStoreFake.update).toHaveBeenLastCalledWith({
			unitPreferences: { distanceUnit: 'miles', volumeUnit: 'gallons_uk', chargeUnit: 'kwh' }
		});

		loadsWith(
			makeSettings({
				unitPreferences: { distanceUnit: 'miles', volumeUnit: 'gallons_uk', chargeUnit: 'kwh' }
			})
		);
		pending[1]!();
		await settle();
		expect(stubInput('stub volume')).toHaveValue('gallons_uk');
		expect(settingsStoreFake.load).toHaveBeenCalledTimes(1);

		pending[0]!();
		await settle();
		expect(settingsStoreFake.load).toHaveBeenCalledTimes(2);
		expect(stubInput('stub distance')).toHaveValue('miles');
		expect(stubInput('stub volume')).toHaveValue('gallons_uk');
	});

	test('after a save the pickers re-sync to what the server returned', async () => {
		settingsStoreFake.update.mockImplementation(async updates => {
			const next = makeSettings({ ...updates, currencyUnit: 'CAD' });
			fakeSettingsState.settings = next;
			return next;
		});
		await mount();
		await change('stub currency', 'usd');
		expect(stubInput('stub currency')).toHaveValue('CAD');
	});

	test('a save failure reports an error and puts the saved value back', async () => {
		loadsWith(makeSettings({ syncOnInactivity: false }));
		settingsStoreFake.update.mockRejectedValue(new ApiError('SQLITE_BUSY', 500));
		await mount();
		await change('stub currency', 'GBP');
		expect(showError).toHaveBeenCalledWith(`Couldn't save settings. ${SERVER_FAILURE_MESSAGE}`);
		expect(showSuccess).not.toHaveBeenCalled();
		expect(stubInput('stub currency')).toHaveValue('EUR');
	});

	test('a settings save in flight counts as unsaved changes until the page closes', async () => {
		loadsWith(makeSettings({ syncOnInactivity: false }));
		settingsStoreFake.update.mockReturnValue(new Promise(() => {}));
		const { unmount } = await mount();
		expect(hasPendingSave()).toBe(false);

		await change('stub distance', 'miles');

		expect(hasPendingSave()).toBe(true);
		unmount();
		expect(hasPendingSave()).toBe(false);
	});
});

describe('Settings page backups', () => {
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

	test('a failed download explains why', async () => {
		settingsStoreFake.downloadBackup.mockRejectedValue(new ApiError('zip stream broke', 500));
		await mount();
		await fireEvent.click(screen.getByRole('button', { name: 'stub download' }));
		await settle();
		expect(showError).toHaveBeenCalledWith(
			`Couldn't download the backup. ${SERVER_FAILURE_MESSAGE}`
		);
	});
});
