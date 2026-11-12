import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getSystemTheme, themeStore } from '../theme.svelte';

const STORAGE_KEY = 'vroom-theme-preference';

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
	let meta = document.querySelector('meta[name="theme-color"]');
	if (!meta) {
		meta = document.createElement('meta');
		meta.setAttribute('name', 'theme-color');
		document.head.appendChild(meta);
	}
	meta.setAttribute('content', '');
	mockSystemDark(false);
});

afterEach(() => {
	vi.clearAllMocks();
});

function htmlIsDark(): boolean {
	return document.documentElement.classList.contains('dark');
}
function themeColor(): string | null {
	return document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null;
}

describe('themeStore.setPreference — explicit light/dark', () => {
	test("'dark' adds the html dark class + sets the dark theme-color + persists + updates current", () => {
		themeStore.setPreference('dark');
		expect(htmlIsDark()).toBe(true);
		expect(themeColor()).toBe('#09090b');
		expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
		expect(themeStore.current).toBe('dark');
	});

	test("'light' removes the dark class + sets the light theme-color + persists", () => {
		themeStore.setPreference('dark');
		themeStore.setPreference('light');
		expect(htmlIsDark()).toBe(false);
		expect(themeColor()).toBe('#ffffff');
		expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
		expect(themeStore.current).toBe('light');
	});
});

describe('themeStore.setPreference — system resolves against the OS preference', () => {
	test("'system' with OS=dark resolves to the dark class", () => {
		mockSystemDark(true);
		themeStore.setPreference('system');
		expect(htmlIsDark()).toBe(true);
		expect(themeColor()).toBe('#09090b');
		expect(localStorage.getItem(STORAGE_KEY)).toBe('system');
		expect(themeStore.current).toBe('system');
	});

	test("'system' with OS=light resolves to no dark class", () => {
		mockSystemDark(false);
		themeStore.setPreference('system');
		expect(htmlIsDark()).toBe(false);
		expect(themeColor()).toBe('#ffffff');
		expect(themeStore.current).toBe('system');
	});

	test('the SAME system preference flips with the OS (not frozen at set time)', () => {
		mockSystemDark(false);
		themeStore.setPreference('system');
		expect(htmlIsDark()).toBe(false);
		mockSystemDark(true);
		themeStore.setPreference('system');
		expect(htmlIsDark()).toBe(true);
	});
});

describe('themeStore.setTheme — the theme-color meta follows the active theme surface', () => {
	afterEach(() => {
		themeStore.setTheme('default');
	});

	test('switching to aurora (light) tints the meta to aurora.light background', () => {
		themeStore.setPreference('light');
		themeStore.setTheme('aurora');
		expect(document.documentElement.getAttribute('data-theme')).toBe('aurora');
		expect(themeColor()).toBe('#f5f8ff');
	});

	test('switching to aurora (dark) tints the meta to aurora.dark background', () => {
		themeStore.setPreference('dark');
		themeStore.setTheme('aurora');
		expect(themeColor()).toBe('#091123');
	});

	test('an unknown theme id falls back to the default surface', () => {
		themeStore.setPreference('light');
		themeStore.setTheme('no-such-theme');
		expect(themeColor()).toBe('#ffffff');
	});
});

describe('getSystemTheme — the shared OS color-scheme resolver (dedup anchor)', () => {
	test('returns "dark" when the OS prefers dark', () => {
		mockSystemDark(true);
		expect(getSystemTheme()).toBe('dark');
	});

	test('returns "light" when the OS prefers light', () => {
		mockSystemDark(false);
		expect(getSystemTheme()).toBe('light');
	});

	test('queries the prefers-color-scheme: dark media query (not some other signal)', () => {
		const spy = vi.mocked(window.matchMedia);
		spy.mockClear();
		mockSystemDark(true);
		getSystemTheme();
		expect(spy).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
	});
});
