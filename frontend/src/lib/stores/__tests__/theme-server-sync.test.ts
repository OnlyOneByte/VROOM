/**
 * Theming engine T9 — themeStore server sync + hydrate reconcile (D2, cross-device correctness).
 *
 * setTheme pushes themePreference to the settings PUT but is FAIL-SOFT (a network/auth error must never
 * revert or blank the theme the user just picked — the local mirror is the session source of truth).
 * reconcileServerTheme is the server-wins hydrate path: on settingsStore.load(), a server value that
 * differs from the local mirror is adopted (mirror + data-theme updated) and NOT re-pushed; an equal or
 * absent server value is a no-op. Pins the precedence so a regression can't silently drop cross-device
 * sync or let a failed push clobber the active theme.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Mock the settings API so setTheme's background push is observable + never hits the network.
const updateSettings = vi.fn(async (_updates: unknown) => ({}) as unknown);
vi.mock('$lib/services/settings-api', () => ({
	settingsApi: { updateSettings: (u: unknown) => updateSettings(u) }
}));

import { themeStore } from '../theme.svelte';

const THEME_ID_KEY = 'vroom-theme-id';

function dataTheme(): string | null {
	return document.documentElement.getAttribute('data-theme');
}

beforeEach(() => {
	localStorage.clear();
	document.documentElement.classList.remove('dark');
	document.documentElement.removeAttribute('data-theme');
	updateSettings.mockClear();
	updateSettings.mockResolvedValue({} as unknown);
	// Reset the singleton store's id axis to default (then clear the push that caused).
	themeStore.setTheme('default');
	localStorage.clear();
	updateSettings.mockClear();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('themeStore.setTheme — server sync (T9)', () => {
	test('pushes the chosen themePreference to the settings PUT', () => {
		themeStore.setTheme('instrument');
		expect(updateSettings).toHaveBeenCalledWith({ themePreference: 'instrument' });
	});

	test('is FAIL-SOFT: a rejected server push does not revert the locally-applied theme', async () => {
		updateSettings.mockRejectedValueOnce(new Error('network down'));
		themeStore.setTheme('instrument');
		// The local apply already happened synchronously, and the rejection is swallowed.
		expect(themeStore.themeId).toBe('instrument');
		expect(dataTheme()).toBe('instrument');
		expect(localStorage.getItem(THEME_ID_KEY)).toBe('instrument');
		// Let the rejected promise settle — it must not throw out of the store.
		await Promise.resolve();
		expect(themeStore.themeId).toBe('instrument');
	});
});

describe('themeStore.reconcileServerTheme — server-wins hydrate (T9/D2)', () => {
	test('adopts a server theme id that differs from the local mirror (server wins)', () => {
		themeStore.setTheme('default');
		updateSettings.mockClear();
		themeStore.reconcileServerTheme('instrument');
		expect(themeStore.themeId).toBe('instrument');
		expect(dataTheme()).toBe('instrument');
		expect(localStorage.getItem(THEME_ID_KEY)).toBe('instrument');
	});

	test('does NOT re-push the adopted server value (server already has it)', () => {
		updateSettings.mockClear();
		themeStore.reconcileServerTheme('instrument');
		expect(updateSettings).not.toHaveBeenCalled();
	});

	test('is a no-op when the server value equals the local mirror', () => {
		themeStore.setTheme('instrument');
		updateSettings.mockClear();
		themeStore.reconcileServerTheme('instrument');
		expect(themeStore.themeId).toBe('instrument');
		expect(updateSettings).not.toHaveBeenCalled();
	});

	test('is a no-op for an absent/null server value (keeps the local mirror)', () => {
		themeStore.setTheme('instrument');
		updateSettings.mockClear();
		themeStore.reconcileServerTheme(null);
		themeStore.reconcileServerTheme(undefined);
		themeStore.reconcileServerTheme('');
		expect(themeStore.themeId).toBe('instrument');
		expect(updateSettings).not.toHaveBeenCalled();
	});
});
