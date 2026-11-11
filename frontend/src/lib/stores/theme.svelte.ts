import { browser } from '$app/environment';
import { settingsApi } from '$lib/services/settings-api';

export type ThemePreference = 'light' | 'dark' | 'system';

// Literal rather than imported from theme-registry, which would put every token on the root layout's path.
const DEFAULT_THEME_ID = 'default';

const STORAGE_KEY = 'vroom-theme-preference';
// Stored separately from the light/dark mode so the anti-FOUC head script in app.html reads the same key.
// data-theme on <html> selects the themes.css block; absent or "default" uses app.css's bare :root.
const THEME_ID_KEY = 'vroom-theme-id';

function getStoredPreference(): ThemePreference {
	if (!browser) return 'system';
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
	return 'system';
}

function getStoredThemeId(): string {
	if (!browser) return DEFAULT_THEME_ID;
	return localStorage.getItem(THEME_ID_KEY) || DEFAULT_THEME_ID;
}

/** Single source for what `system` resolves to right now; the theme picker preview imports it too. */
export function getSystemTheme(): 'light' | 'dark' {
	if (!browser) return 'light';
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Used when the theme's background cannot be resolved, so the theme-color meta is never blank.
const FALLBACK_THEME_COLOR = { light: '#2563eb', dark: '#1a1a2e' } as const;

// Each theme's background as hex: browser chrome does not reliably honor oklch() in theme-color.
// theme-background-hex.test.ts fails if this drifts from THEME_REGISTRY.
const THEME_BACKGROUND_HEX: Record<string, { light: string; dark: string }> = {
	default: { light: '#ffffff', dark: '#09090b' },
	blueprint: { light: '#f2fafe', dark: '#091c2c' },
	bento: { light: '#f3f5f9', dark: '#0d0f15' },
	vaporwave: { light: '#fbf1fe', dark: '#2a013f' },
	cyberpunk: { light: '#eef7fa', dark: '#060e15' },
	aurora: { light: '#f5f8ff', dark: '#091123' },
	solarpunk: { light: '#f2efe0', dark: '#201910' },
	editorial: { light: '#f9f5ec', dark: '#1b1715' },
	tui: { light: '#f4f2ea', dark: '#0e0d0b' },
	y2k: { light: '#eefbff', dark: '#0c0e1c' },
	neobrutalist: { light: '#f7f5ee', dark: '#0c0d12' }
};

// Unknown ids fall back to the default theme; a missing entry falls back to the mode hex.
function resolveThemeColor(themeId: string, resolved: 'light' | 'dark'): string {
	const theme = THEME_BACKGROUND_HEX[themeId] ?? THEME_BACKGROUND_HEX[DEFAULT_THEME_ID];
	return theme?.[resolved] ?? FALLBACK_THEME_COLOR[resolved];
}

/** Applies both axes to <html>: `dark` class and theme-color meta for the mode, data-theme for the id. */
function applyTheme(preference: ThemePreference, themeId: string = getStoredThemeId()) {
	if (!browser) return;
	const resolved = preference === 'system' ? getSystemTheme() : preference;
	const root = document.documentElement;
	root.classList.toggle('dark', resolved === 'dark');

	if (themeId && themeId !== DEFAULT_THEME_ID) {
		root.setAttribute('data-theme', themeId);
	} else {
		root.removeAttribute('data-theme');
	}

	// Browser chrome cannot be screenshot-tested, so this meta update is covered by unit tests only.
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta) {
		meta.setAttribute('content', resolveThemeColor(themeId, resolved));
	}
}

// Best-effort: errors are swallowed so they never revert the local choice, which stays the source of truth for the session.
function persistThemeToServer(id: string): void {
	if (!browser) return;
	settingsApi.updateSettings({ themePreference: id }).catch(err => {
		if (import.meta.env.DEV) console.error('Failed to sync themePreference to server:', err);
	});
}

function createThemeStore() {
	let current = $state<ThemePreference>(getStoredPreference());
	let themeId = $state<string>(getStoredThemeId());
	let initialized = false;

	return {
		get current() {
			return current;
		},

		get themeId() {
			return themeId;
		},

		initialize() {
			if (initialized) return;
			initialized = true;

			const preference = getStoredPreference();
			const id = getStoredThemeId();
			applyTheme(preference, id);
			current = preference;
			themeId = id;

			if (browser) {
				window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
					const stored = getStoredPreference();
					if (stored === 'system') {
						applyTheme('system', themeId);
					}
				});
			}
		},

		setPreference(preference: ThemePreference) {
			if (browser) {
				localStorage.setItem(STORAGE_KEY, preference);
			}
			applyTheme(preference, themeId);
			current = preference;
		},

		// An unknown id is stored and applied anyway; the CSS falls back to the default look, so a stale id degrades instead of throwing.
		setTheme(id: string) {
			if (browser) {
				localStorage.setItem(THEME_ID_KEY, id);
			}
			themeId = id;
			applyTheme(current, id);
			persistThemeToServer(id);
		},

		// Server wins on settings load. Adopts the server's id without re-pushing it.
		reconcileServerTheme(serverThemeId: string | null | undefined) {
			if (!serverThemeId || serverThemeId === themeId) return;
			if (browser) {
				localStorage.setItem(THEME_ID_KEY, serverThemeId);
			}
			themeId = serverThemeId;
			applyTheme(current, serverThemeId);
		}
	};
}

export const themeStore = createThemeStore();
