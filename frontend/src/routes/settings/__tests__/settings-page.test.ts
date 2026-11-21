import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { User, UserProviderInfo, UserSettings } from '#lib/types/index.ts';
import { fakeSettingsState, settingsStoreFake } from './settings-store-fake.svelte.ts';

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
	toast: { loading: vi.fn(), error: vi.fn(), info: vi.fn(), success: vi.fn() }
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

async function save() {
	await fireEvent.click(screen.getByRole('button', { name: /Save Settings/ }));
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
		const next = { ...makeSettings(), ...updates } as UserSettings;
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

	test('shows a spinner and no save button while loading', async () => {
		settingsStoreFake.load.mockImplementation(async () => {
			fakeSettingsState.isLoading = true;
		});
		const { container } = await mount();
		expect(container.querySelector('.animate-spin')).not.toBeNull();
		expect(screen.queryByRole('button', { name: /Save Settings/ })).toBeNull();
	});

	test('a load failure shows the error and retry reloads everything', async () => {
		settingsStoreFake.load.mockImplementationOnce(async () => {
			fakeSettingsState.error = 'Server unavailable';
		});
		await mount();
		expect(screen.getByText('Failed to load settings')).toBeInTheDocument();
		expect(screen.getByText('Server unavailable')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /Save Settings/ })).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await settle();
		expect(settingsStoreFake.load).toHaveBeenCalledTimes(2);
		expect(getProviders).toHaveBeenCalledTimes(2);
		expect(screen.queryByText('Failed to load settings')).toBeNull();
		expect(screen.getByRole('button', { name: /Save Settings/ })).toBeInTheDocument();
	});

	test('a storage-provider load failure still renders the page', async () => {
		getProviders.mockRejectedValue(new Error('offline'));
		await mount();
		expect(screen.getByRole('button', { name: /Save Settings/ })).toBeInTheDocument();
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

	test('saving sends the edited units, currency and existing backup schedule', async () => {
		await mount();
		await fireEvent.input(stubInput('stub distance'), { target: { value: 'miles' } });
		await fireEvent.input(stubInput('stub volume'), { target: { value: 'gallons_uk' } });
		await fireEvent.input(stubInput('stub currency'), { target: { value: 'GBP' } });
		await fireEvent.input(stubInput('stub inactivity'), { target: { value: '30' } });
		await save();

		expect(settingsStoreFake.update).toHaveBeenCalledWith({
			unitPreferences: { distanceUnit: 'miles', volumeUnit: 'gallons_uk', chargeUnit: 'kwh' },
			currencyUnit: 'GBP',
			autoBackupEnabled: true,
			backupFrequency: 'daily',
			syncOnInactivity: false,
			syncInactivityMinutes: 30
		});
		expect(fetchLastSyncTime).toHaveBeenCalledTimes(1);
		expect(showSuccess).toHaveBeenCalledWith('Settings saved successfully');
	});

	test('sync-on-inactivity is requested when any provider has backup or sheets sync on', async () => {
		loadsWith(
			makeSettings({
				backupConfig: {
					providers: {
						p1: { enabled: false, folderPath: '/', retentionCount: 5, sheetsSyncEnabled: true }
					}
				}
			})
		);
		await mount();
		await save();
		expect(settingsStoreFake.update).toHaveBeenCalledWith(
			expect.objectContaining({ syncOnInactivity: true })
		);
	});

	test('after saving the form re-syncs to what the server returned', async () => {
		settingsStoreFake.update.mockImplementation(async updates => {
			const next = makeSettings({ ...updates, currencyUnit: 'CAD' });
			fakeSettingsState.settings = next;
			return next;
		});
		await mount();
		await fireEvent.input(stubInput('stub currency'), { target: { value: 'usd' } });
		await save();
		expect(stubInput('stub currency')).toHaveValue('CAD');
	});

	test('a save failure reports an error', async () => {
		settingsStoreFake.update.mockRejectedValue(new Error('500'));
		await mount();
		await save();
		expect(showError).toHaveBeenCalledWith('Failed to save settings');
		expect(showSuccess).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: /Save Settings/ })).not.toBeDisabled();
	});

	test('the save button shows a saving state while the request is pending', async () => {
		settingsStoreFake.update.mockReturnValue(new Promise(() => {}));
		await mount();
		await save();
		expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled();
	});
});
