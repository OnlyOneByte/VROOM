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
import { getSystemTheme, themeStore } from '../theme.svelte';

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
	// #333: the theme-color meta now tracks the ACTIVE theme's `background` token (oklch→hex), not a fixed
	// brand hex. With no theme id set (beforeEach clears localStorage → default theme), the default
	// background tokens are oklch(1 0 0) → #ffffff (light) and oklch(0.141 0.005 285.823) → #09090b (dark).
	test("'dark' adds the html dark class + sets the dark theme-color + persists + updates current", () => {
		themeStore.setPreference('dark');
		expect(htmlIsDark()).toBe(true);
		expect(themeColor()).toBe('#09090b'); // default.dark background token, oklch→hex
		expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
		expect(themeStore.current).toBe('dark');
	});

	test("'light' removes the dark class + sets the light theme-color + persists", () => {
		themeStore.setPreference('dark'); // start dark
		themeStore.setPreference('light');
		expect(htmlIsDark()).toBe(false);
		expect(themeColor()).toBe('#ffffff'); // default.light background token, oklch→hex
		expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
		expect(themeStore.current).toBe('light');
	});
});

describe('themeStore.setPreference — system resolves against the OS preference', () => {
	test("'system' with OS=dark resolves to the dark class", () => {
		mockSystemDark(true);
		themeStore.setPreference('system');
		expect(htmlIsDark()).toBe(true);
		expect(themeColor()).toBe('#09090b'); // default.dark background, resolved via the OS preference
		// The stored PREFERENCE is 'system' (not the resolved 'dark') — the OS choice isn't frozen in.
		expect(localStorage.getItem(STORAGE_KEY)).toBe('system');
		expect(themeStore.current).toBe('system');
	});

	test("'system' with OS=light resolves to no dark class", () => {
		mockSystemDark(false);
		themeStore.setPreference('system');
		expect(htmlIsDark()).toBe(false);
		expect(themeColor()).toBe('#ffffff'); // default.light background, resolved via the OS preference
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

/**
 * #333 — the PWA theme-color meta tracks the ACTIVE THEME's surface, not a fixed brand hex. Switching the
 * theme-id axis re-tints the address bar to that theme's `background` token (oklch→hex), per resolved mode.
 * These pin the new wiring: aurora's surface differs from default's, in both light and dark.
 */
describe('themeStore.setTheme — the theme-color meta follows the active theme surface (#333)', () => {
	afterEach(() => {
		// Reset the id axis so other suites see the default theme.
		themeStore.setTheme('default');
	});

	test('switching to aurora (light) tints the meta to aurora.light background', () => {
		themeStore.setPreference('light');
		themeStore.setTheme('aurora');
		expect(document.documentElement.getAttribute('data-theme')).toBe('aurora');
		expect(themeColor()).toBe('#f5f8ff'); // aurora.light background oklch(0.98 0.01 265) → hex
	});

	test('switching to aurora (dark) tints the meta to aurora.dark background', () => {
		themeStore.setPreference('dark');
		themeStore.setTheme('aurora');
		expect(themeColor()).toBe('#091123'); // aurora.dark background oklch(0.18 0.04 265) → hex
	});

	test('an unknown theme id falls back to the default surface (graceful R8 degrade)', () => {
		themeStore.setPreference('light');
		themeStore.setTheme('no-such-theme');
		// Unknown id → resolveThemeColor falls back to the default theme background (#ffffff), never blank.
		expect(themeColor()).toBe('#ffffff');
	});
});

/**
 * C349 (arch) — getSystemTheme is the SINGLE OS-color-scheme resolver, now SHARED by the store's applyTheme
 * AND ThemePickerCard's swatch preview (was duplicated as a private `systemPref()` copy in the picker). It
 * was only ever driven transitively through setPreference('system'); these pin its OWN contract directly so
 * the now-shared helper is anchored (arch rule 3 — characterize before consolidating). The picker imports
 * THIS function, so a regression to its media query or SSR default trips here, protecting the C348
 * preview-vs-applied coupling (both resolve `system` through the same code → they cannot disagree).
 */
describe('getSystemTheme — the shared OS color-scheme resolver (C349 dedup anchor)', () => {
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
