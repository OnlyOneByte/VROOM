import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { hasPendingSave } from '#lib/utils/pending-saves.ts';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import type { User, UserProviderInfo, UserSettings } from '#lib/types/index.ts';
import { fakeSettingsState, settingsStoreFake } from './settings-store-fake.svelte.ts';
import { ApiError, SERVER_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';
import { packRules } from '@casl/ability/extra';
import type { PackedRules } from '#lib/utils/permissions.ts';

const { showError, showSuccess, getProviders, fetchLastSyncTime, goto } = vi.hoisted(() => ({
	showError: vi.fn<(message: string) => void>(),
	showSuccess: vi.fn<(message: string) => void>(),
	getProviders: vi.fn<(domain?: string) => Promise<UserProviderInfo[]>>(),
	fetchLastSyncTime: vi.fn<() => Promise<void>>(),
	goto: vi.fn(async () => {})
}));

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$app/navigation', () => ({ goto }));
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
const { serverRules } = vi.hoisted(() => ({
	serverRules: vi.fn<() => Promise<PackedRules>>(async () => [])
}));
vi.mock('#lib/services/signup-api.ts', () => ({ signupApi: { serverRules } }));
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
vi.mock('#lib/components/settings/cards/UnitPreferencesCard.svelte', stub);
vi.mock('#lib/components/settings/cards/ThemeCard.svelte', stub);
vi.mock('#lib/components/settings/cards/ThemePickerCard.svelte', stub);
vi.mock('#lib/components/settings/cards/PwaInstallCard.svelte', stub);
vi.mock('#lib/components/settings/cards/PushNotificationsCard.svelte', stub);
vi.mock('#lib/components/settings/cards/CalendarFeedCard.svelte', stub);
vi.mock('#lib/components/settings/cards/StorageProvidersCard.svelte', stub);
vi.mock('#lib/components/settings/cards/ModelProvidersCard.svelte', stub);
vi.mock('#lib/components/settings/cards/MigrateFromTrackerCard.svelte', async () => ({
	default: (await import('./MigrateStub.svelte')).default
}));
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
		expect(screen.getByTestId('settings-ai-summary')).toBeInTheDocument();
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
		expect(screen.queryByTestId('stub-charge')).toBeNull();

		finish();
		await settle();
		const card = screen.getByTestId('stub-charge');

		fakeSettingsState.isLoading = true;
		await settle();
		expect(screen.getByTestId('stub-charge')).toBe(card);
	});

	test('a load failure shows the error and retry reloads everything', async () => {
		settingsStoreFake.load.mockImplementationOnce(async () => {
			fakeSettingsState.error = SERVER_FAILURE_MESSAGE;
		});
		await mount();
		expect(screen.getByText("Couldn't load settings")).toBeInTheDocument();
		expect(screen.getByText(SERVER_FAILURE_MESSAGE)).toBeInTheDocument();
		expect(screen.queryByTestId('settings-ai-summary')).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await settle();
		expect(settingsStoreFake.load).toHaveBeenCalledTimes(2);
		expect(getProviders).toHaveBeenCalledTimes(2);
		expect(screen.queryByText("Couldn't load settings")).toBeNull();
		expect(screen.getByTestId('settings-ai-summary')).toBeInTheDocument();
	});

	test('a storage-provider load failure still renders the page', async () => {
		getProviders.mockRejectedValue(new Error('offline'));
		await mount();
		expect(screen.getByTestId('settings-ai-summary')).toBeInTheDocument();
	});

	test('the Account section shows the name and email and links to the profile', async () => {
		await mount();
		const account = within(screen.getByRole('region', { name: 'Account' }));
		expect(account.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile');
		expect(account.getByText('Ada Lovelace')).toBeInTheDocument();
		expect(account.getByText('ada@example.com')).toBeInTheDocument();
	});

	test('Sign out signs the user out, and a failure says so', async () => {
		const logout = vi.spyOn(authStore, 'logout').mockResolvedValueOnce();
		await mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
		await settle();
		expect(logout).toHaveBeenCalledOnce();

		logout.mockRejectedValueOnce(new ApiError('down', 500));
		await fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
		await settle();
		expect(showError).toHaveBeenCalledWith(expect.stringContaining("Couldn't sign out"));
		logout.mockRestore();
	});

	test('a sign-out in flight disables the button, so a second click sends nothing', async () => {
		let finish = () => {};
		const logout = vi
			.spyOn(authStore, 'logout')
			.mockImplementation(() => new Promise<void>(resolve => (finish = resolve)));
		await mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
		await settle();

		const busy = screen.getByRole('button', { name: /Signing out/ });
		expect(busy).toBeDisabled();
		await fireEvent.click(busy);
		expect(logout).toHaveBeenCalledOnce();

		finish();
		await settle();
		expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
		logout.mockRestore();
	});

	test('only someone who manages sign-up sees the Server link', async () => {
		await mount();
		expect(screen.queryByTestId('settings-server-link')).toBeNull();
		cleanup();

		serverRules.mockResolvedValueOnce(
			packRules([{ action: 'server.signup.manage', subject: 'all' }]) as PackedRules
		);
		await mount();
		expect(screen.getByTestId('settings-server-link')).toHaveAttribute('href', '/settings/server');
	});

	test('the Account section falls back to generic text without a user', async () => {
		authStore.clearUser();
		await mount();
		const account = within(screen.getByRole('region', { name: 'Account' }));
		expect(account.getByText('User')).toBeInTheDocument();
		expect(account.queryByText(/@/)).toBeNull();
	});

	test('Your data holds the import tool and the one Export button', async () => {
		await mount();
		const data = screen.getByRole('region', { name: 'Your data' });
		expect(data).toContainElement(screen.getByTestId('stub-migrate'));
		expect(within(data).getByRole('button', { name: 'Export' })).toBeInTheDocument();
	});

	test('AI helpers links to its page, and the provider cards no longer sit on Settings', async () => {
		await mount();
		const ai = within(screen.getByRole('region', { name: 'AI helpers' }));
		expect(ai.getByRole('link', { name: 'Manage AI helpers' })).toHaveAttribute(
			'href',
			'/settings/ai'
		);
		expect(screen.queryByTestId('stub-model-vlm')).toBeNull();
		expect(screen.queryByTestId('stub-model-llm')).toBeNull();
		expect(screen.queryByRole('region', { name: 'Connections' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'stub backup now' })).toBeNull();
	});

	test.each([
		['#settings-ai', '/settings/ai'],
		['#receipt-scanning', '/settings/ai#receipt-scanning'],
		['#assistant-providers', '/settings/ai#assistant-providers']
	])('an old link to %s goes to the AI helpers page', async (hash, target) => {
		window.history.replaceState(null, '', `/settings${hash}`);
		await mount();
		expect(goto).toHaveBeenCalledWith(target, { replaceState: true });
		expect(settingsStoreFake.load).not.toHaveBeenCalled();
		window.history.replaceState(null, '', '/');
	});

	test.each([
		[[], 'Not set up yet'],
		[
			[
				{ id: 'p1', displayName: 'Family Drive' },
				{ id: 'p2', displayName: 'Office S3' }
			],
			'Family Drive · Office S3'
		]
	])('Backups and storage links to its page and sums up %o', async (providers, summary) => {
		getProviders.mockResolvedValue(providers as UserProviderInfo[]);
		await mount();
		const storage = within(screen.getByRole('region', { name: 'Backups and storage' }));
		expect(storage.getByRole('link', { name: 'Manage backups and storage' })).toHaveAttribute(
			'href',
			'/settings/storage'
		);
		expect(screen.getByTestId('settings-storage-summary')).toHaveTextContent(summary);
	});

	test('the section header links are 40px tap targets', async () => {
		await mount();
		for (const name of ['Profile', 'Manage backups and storage', 'Manage AI helpers']) {
			expect(screen.getByRole('link', { name })).toHaveClass(
				'inline-flex',
				'min-h-10',
				'items-center'
			);
		}
	});

	test('an old link to the storage section goes to the Backups and storage page', async () => {
		window.history.replaceState(null, '', '/settings#settings-connections');
		await mount();
		expect(goto).toHaveBeenCalledWith('/settings/storage', { replaceState: true });
		expect(settingsStoreFake.load).not.toHaveBeenCalled();
		window.history.replaceState(null, '', '/');
	});
});

describe('Settings page preferences', () => {
	test('initialises the unit and currency pickers from saved settings', async () => {
		await mount();
		expect(stubInput('stub distance')).toHaveValue('kilometers');
		expect(stubInput('stub volume')).toHaveValue('liters');
		expect(stubInput('stub currency')).toHaveValue('EUR');
		expect(screen.getByTestId('stub-charge')).toHaveTextContent('kwh');
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

	test('a pick made while the post-overlap reload waits is not undone by that late reply', async () => {
		const saves: Array<() => void> = [];
		settingsStoreFake.update.mockImplementation(
			updates =>
				new Promise(resolve => {
					saves.push(() => {
						const next = { ...fakeSettingsState.settings, ...updates } as UserSettings;
						fakeSettingsState.settings = next;
						resolve(next);
					});
				})
		);
		await mount();
		await change('stub distance', 'miles');
		await change('stub volume', 'gallons_uk');

		const reloads: Array<() => void> = [];
		const stale = makeSettings();
		settingsStoreFake.load.mockImplementation(
			() =>
				new Promise<void>(resolve => {
					reloads.push(() => {
						fakeSettingsState.settings = { ...stale };
						resolve();
					});
				})
		);
		saves[0]!();
		saves[1]!();
		await settle();
		expect(reloads).toHaveLength(1);

		await change('stub currency', 'GBP');
		saves[2]!();
		await settle();
		reloads[0]!();
		await settle();

		expect(stubInput('stub currency')).toHaveValue('GBP');
		expect(reloads).toHaveLength(2);

		stale.currencyUnit = 'GBP';
		reloads[1]!();
		await settle();
		expect(stubInput('stub currency')).toHaveValue('GBP');
		expect(reloads).toHaveLength(2);
	});

	test('two overlapping picks during the reload cannot ride the same stale reply back in', async () => {
		const saves: Array<() => void> = [];
		settingsStoreFake.update.mockImplementation(
			updates =>
				new Promise(resolve => {
					saves.push(() => {
						const next = { ...fakeSettingsState.settings, ...updates } as UserSettings;
						fakeSettingsState.settings = next;
						resolve(next);
					});
				})
		);
		await mount();
		await change('stub distance', 'miles');
		await change('stub volume', 'gallons_uk');

		const reloads: Array<() => void> = [];
		const server = makeSettings();
		let inFlight: Promise<void> | null = null;
		settingsStoreFake.load.mockImplementation(() => {
			if (inFlight) return inFlight;
			const request = new Promise<void>(resolve => {
				const snapshot = { ...server };
				reloads.push(() => {
					fakeSettingsState.settings = snapshot;
					resolve();
				});
			}).finally(() => {
				if (inFlight === request) inFlight = null;
			});
			inFlight = request;
			return request;
		});
		saves[0]!();
		saves[1]!();
		await settle();
		expect(reloads).toHaveLength(1);

		await change('stub currency', 'GBP');
		await change('stub distance', 'kilometers');
		saves[2]!();
		saves[3]!();
		await settle();
		server.currencyUnit = 'GBP';
		reloads[0]!();
		await settle();

		expect(stubInput('stub currency')).toHaveValue('GBP');
		expect(reloads).toHaveLength(2);
		reloads[1]!();
		await settle();
		expect(stubInput('stub currency')).toHaveValue('GBP');
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

describe('Settings page export', () => {
	test('a failed download explains why', async () => {
		settingsStoreFake.downloadBackup.mockRejectedValue(new ApiError('zip stream broke', 500));
		await mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Export' }));
		await settle();
		expect(showError).toHaveBeenCalledWith(
			`Couldn't download the backup. ${SERVER_FAILURE_MESSAGE}`
		);
	});
});

describe('Settings page community comparisons card', () => {
	test('shows the card when the server mode is local or not reported', async () => {
		loadsWith(makeSettings({ communityStatsMode: 'local' }));
		await mount();
		expect(screen.getByText('Community comparisons')).toBeInTheDocument();
		cleanup();
		loadsWith(makeSettings());
		await mount();
		expect(screen.getByText('Community comparisons')).toBeInTheDocument();
	});

	test('hides the card when the server has community stats turned off', async () => {
		loadsWith(makeSettings({ communityStatsMode: 'off', communityStatsOptIn: true }));
		await mount();
		expect(screen.queryByText('Community comparisons')).toBeNull();
	});

	test('turning it on saves through the settings store and confirms', async () => {
		await mount();
		await fireEvent.click(
			screen.getByRole('switch', { name: 'Include my vehicles in community stats' })
		);
		await settle();
		expect(settingsStoreFake.update).toHaveBeenCalledWith({ communityStatsOptIn: true });
		expect(showSuccess).toHaveBeenCalledWith('Community stats turned on');
	});
});
