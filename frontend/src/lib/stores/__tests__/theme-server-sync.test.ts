import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

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
	themeStore.setTheme('default');
	localStorage.clear();
	updateSettings.mockClear();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('themeStore.setTheme server sync', () => {
	test('pushes the chosen themePreference to the settings PUT', () => {
		themeStore.setTheme('instrument');
		expect(updateSettings).toHaveBeenCalledWith({ themePreference: 'instrument' });
	});

	test('is FAIL-SOFT: a rejected server push does not revert the locally-applied theme', async () => {
		updateSettings.mockRejectedValueOnce(new Error('network down'));
		themeStore.setTheme('instrument');
		expect(themeStore.themeId).toBe('instrument');
		expect(dataTheme()).toBe('instrument');
		expect(localStorage.getItem(THEME_ID_KEY)).toBe('instrument');
		await Promise.resolve();
		expect(themeStore.themeId).toBe('instrument');
	});
});

describe('themeStore.reconcileServerTheme server-wins hydrate', () => {
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
