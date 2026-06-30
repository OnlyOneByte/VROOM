/**
 * Theming engine T8 — the themeStore `themeId` axis (orthogonal to the light/dark mode).
 *
 * setTheme persists the `vroom-theme-id` mirror + applies `data-theme` on <html> (which drives the
 * generated themes.css blocks), the `default` id REMOVES data-theme (app.css's bare :root serves the
 * identity theme), and the mode axis (setPreference / the OS listener) preserves the active theme id.
 * Pins the load-bearing observable effects (the C100/C101/C336 store-guard pattern). A regression here
 * silently breaks theme switching (wrong/absent data-theme = the registry block never applies).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { themeStore } from '../theme.svelte';

const THEME_ID_KEY = 'vroom-theme-id';

function mockSystemDark(isDark: boolean): void {
	vi.mocked(window.matchMedia).mockReturnValue({
		matches: isDark,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn()
	} as unknown as MediaQueryList);
}

beforeEach(() => {
	localStorage.clear();
	document.documentElement.classList.remove('dark');
	document.documentElement.removeAttribute('data-theme');
	// Reset the store's id axis to default between cases (singleton — state persists across tests).
	themeStore.setTheme('default');
	localStorage.clear();
	mockSystemDark(false);
});

afterEach(() => {
	vi.clearAllMocks();
});

function dataTheme(): string | null {
	return document.documentElement.getAttribute('data-theme');
}

describe('themeStore.setTheme — the theme-id axis', () => {
	test('a non-default id sets data-theme on <html> + persists the mirror + updates themeId', () => {
		themeStore.setTheme('instrument');
		expect(dataTheme()).toBe('instrument');
		expect(localStorage.getItem(THEME_ID_KEY)).toBe('instrument');
		expect(themeStore.themeId).toBe('instrument');
	});

	test("the 'default' id REMOVES data-theme (app.css bare :root serves the identity theme)", () => {
		themeStore.setTheme('instrument'); // set a non-default first
		expect(dataTheme()).toBe('instrument');
		themeStore.setTheme('default');
		expect(dataTheme()).toBeNull(); // attribute removed, not data-theme="default"
		expect(localStorage.getItem(THEME_ID_KEY)).toBe('default');
		expect(themeStore.themeId).toBe('default');
	});

	test('switching the theme id PRESERVES the current light/dark mode (axes are orthogonal)', () => {
		themeStore.setPreference('dark');
		expect(document.documentElement.classList.contains('dark')).toBe(true);

		themeStore.setTheme('instrument');
		// The dark class must survive a theme-id switch (setTheme re-applies with the CURRENT mode).
		expect(document.documentElement.classList.contains('dark')).toBe(true);
		expect(dataTheme()).toBe('instrument');
	});

	test('switching the mode PRESERVES the active theme id (the data-theme attribute stays)', () => {
		themeStore.setTheme('instrument');
		themeStore.setPreference('light');
		expect(dataTheme()).toBe('instrument'); // mode change must not drop the id
		expect(document.documentElement.classList.contains('dark')).toBe(false);
	});

	test('an unknown id is still stored + applied (degrades to default look via the resolver/CSS, R8)', () => {
		themeStore.setTheme('no-such-theme');
		// setTheme does not validate — it stores + sets data-theme; the CSS simply has no matching block,
		// so the default look shows. The point: it never throws and the mirror reflects the attempt.
		expect(dataTheme()).toBe('no-such-theme');
		expect(localStorage.getItem(THEME_ID_KEY)).toBe('no-such-theme');
	});
});

describe('themeStore.themeId getter', () => {
	test('reflects the persisted id', () => {
		themeStore.setTheme('instrument');
		expect(themeStore.themeId).toBe('instrument');
	});
});
