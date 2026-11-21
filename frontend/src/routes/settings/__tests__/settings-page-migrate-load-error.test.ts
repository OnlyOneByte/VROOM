import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { UserSettings } from '#lib/types/index.ts';
import { fakeSettingsState, settingsStoreFake } from './settings-store-fake.svelte.ts';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/stores/settings.svelte.ts', async () => ({
	settingsStore: (await import('./settings-store-fake.svelte.ts')).settingsStoreFake
}));
vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: { getProviders: () => Promise.resolve([]) }
}));
vi.mock('#lib/utils/sync/sync-manager.ts', () => ({ fetchLastSyncTime: () => Promise.resolve() }));

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
vi.mock('#lib/components/settings/cards/MigrateFromTrackerCard.svelte', () => {
	throw new TypeError('Failed to fetch dynamically imported module');
});

const SettingsPage = (await import('../+page.svelte')).default;

describe('Settings page when the migrate card cannot load', () => {
	test('shows a message in the card’s place instead of dropping it silently', async () => {
		settingsStoreFake.load.mockImplementation(async () => {
			fakeSettingsState.settings = {
				unitPreferences: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' },
				currencyUnit: 'USD',
				syncInactivityMinutes: 5
			} as UserSettings;
		});
		render(SettingsPage);

		expect(await screen.findByTestId('migrate-load-error')).toHaveTextContent(
			"Couldn't load the migration tool. Check your connection and reload."
		);
		expect(screen.getByRole('alert')).toBe(screen.getByTestId('migrate-load-error'));
	});
});
