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
		themeStore.setTheme('electric');
		expect(dataTheme()).toBe('electric');
		expect(localStorage.getItem(THEME_ID_KEY)).toBe('electric');
		expect(themeStore.themeId).toBe('electric');
	});

	test("the 'default' id REMOVES data-theme (app.css bare :root serves the identity theme)", () => {
		themeStore.setTheme('electric');
		expect(dataTheme()).toBe('electric');
		themeStore.setTheme('default');
		expect(dataTheme()).toBeNull();
		expect(localStorage.getItem(THEME_ID_KEY)).toBe('default');
		expect(themeStore.themeId).toBe('default');
	});

	test('switching the theme id PRESERVES the current light/dark mode (axes are orthogonal)', () => {
		themeStore.setPreference('dark');
		expect(document.documentElement.classList.contains('dark')).toBe(true);

		themeStore.setTheme('electric');
		expect(document.documentElement.classList.contains('dark')).toBe(true);
		expect(dataTheme()).toBe('electric');
	});

	test('switching the mode PRESERVES the active theme id (the data-theme attribute stays)', () => {
		themeStore.setTheme('electric');
		themeStore.setPreference('light');
		expect(dataTheme()).toBe('electric');
		expect(document.documentElement.classList.contains('dark')).toBe(false);
	});

	test('an unknown id is stored and applied as the default accent', () => {
		themeStore.setTheme('electric');
		themeStore.setTheme('no-such-theme');
		expect(dataTheme()).toBeNull();
		expect(localStorage.getItem(THEME_ID_KEY)).toBe('default');
		expect(themeStore.themeId).toBe('default');
	});
});

describe('themeStore.themeId getter', () => {
	test('reflects the persisted id', () => {
		themeStore.setTheme('electric');
		expect(themeStore.themeId).toBe('electric');
	});
});
