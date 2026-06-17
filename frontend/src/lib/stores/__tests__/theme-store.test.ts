/**
 * C336 (guard) — pin themeStore, the user-facing light/dark/system theme controller.
 *
 * stores/theme.svelte.ts had ZERO direct test coverage. It's the single source of truth for dark mode:
 * setPreference persists the choice to localStorage, resolves 'system' against the OS
 * prefers-color-scheme, toggles the `dark` class on <html>, and swaps the theme-color meta for the PWA
 * status bar. A regression here silently breaks dark mode for every user (wrong class, unpersisted
 * choice, or a 'system' pick that ignores the OS). These pin the load-bearing observable effects of
 * setPreference (the re-runnable public surface; initialize() is a one-shot guarded by an internal flag):
 *   - explicit 'dark'/'light' → the <html> `dark` class + the theme-color meta track the choice
 *   - 'system' resolves against window.matchMedia('(prefers-color-scheme: dark)')
 *   - the choice is written to localStorage under the stable key, and `current` reflects it
 * NON-VACUOUS: dropping the classList toggle, the meta swap, the persistence, or inverting the system
 * resolution each turns a case RED.
 *
 * Setup: test-setup.ts provides browser=true, a real-ish localStorage mock, and a matchMedia mock
 * (matches:false by default) — we override matchMedia per-case to drive the 'system' branch.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { themeStore } from '../theme.svelte';

const STORAGE_KEY = 'vroom-theme-preference';

/** Point matchMedia('(prefers-color-scheme: dark)') at a chosen OS preference. */
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
	// A theme-color meta for setPreference to update (jsdom has none by default).
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
		expect(themeColor()).toBe('#1a1a2e'); // the dark status-bar color
		expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
		expect(themeStore.current).toBe('dark');
	});

	test("'light' removes the dark class + sets the light theme-color + persists", () => {
		themeStore.setPreference('dark'); // start dark
		themeStore.setPreference('light');
		expect(htmlIsDark()).toBe(false);
		expect(themeColor()).toBe('#2563eb'); // the light status-bar color
		expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
		expect(themeStore.current).toBe('light');
	});
});

describe('themeStore.setPreference — system resolves against the OS preference', () => {
	test("'system' with OS=dark resolves to the dark class", () => {
		mockSystemDark(true);
		themeStore.setPreference('system');
		expect(htmlIsDark()).toBe(true);
		expect(themeColor()).toBe('#1a1a2e');
		// The stored PREFERENCE is 'system' (not the resolved 'dark') — the OS choice isn't frozen in.
		expect(localStorage.getItem(STORAGE_KEY)).toBe('system');
		expect(themeStore.current).toBe('system');
	});

	test("'system' with OS=light resolves to no dark class", () => {
		mockSystemDark(false);
		themeStore.setPreference('system');
		expect(htmlIsDark()).toBe(false);
		expect(themeColor()).toBe('#2563eb');
		expect(themeStore.current).toBe('system');
	});

	test('the SAME system preference flips with the OS (not frozen at set time)', () => {
		mockSystemDark(false);
		themeStore.setPreference('system');
		expect(htmlIsDark()).toBe(false);
		// OS flips to dark; re-applying the same 'system' preference now resolves dark.
		mockSystemDark(true);
		themeStore.setPreference('system');
		expect(htmlIsDark()).toBe(true);
	});
});
