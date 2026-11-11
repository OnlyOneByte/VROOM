import { browser } from '$app/environment';
import { settingsApi } from '$lib/services/settings-api';

export type ThemePreference = 'light' | 'dark' | 'system';

/**
 * The id every unknown/absent selection resolves to. Spelled out here rather than imported from
 * theme-registry so this store — which the root layout initializes, i.e. every route — does not
 * pull the full token registry (every token value for every theme) onto the critical path. The
 * registry is the source of truth; theme-background-hex.test.ts holds this literal to it.
 */
const DEFAULT_THEME_ID = 'default';

const STORAGE_KEY = 'vroom-theme-preference';
// Theming engine (T8): the theme-ID axis, ORTHOGONAL to the light/dark mode above (D3). Persisted to its
// own mirror so the anti-FOUC head-script (app.html) + the store agree. `data-theme` on <html> drives the
// generated themes.css (T7) `:root[data-theme="<id>"]` blocks; absent / "default" → app.css's bare :root.
const THEME_ID_KEY = 'vroom-theme-id';

function getStoredPreference(): ThemePreference {
	if (!browser) return 'system';
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
	return 'system';
}

/** Read the persisted theme id, defaulting to `default` (the identity theme) when unset (R8 mirror). */
function getStoredThemeId(): string {
	if (!browser) return DEFAULT_THEME_ID;
	return localStorage.getItem(THEME_ID_KEY) || DEFAULT_THEME_ID;
}

/**
 * Resolve the OS color-scheme preference to a concrete variant. The SINGLE source of truth for "what does
 * `system` mean right now" — used by applyTheme (the APPLIED theme) AND imported by ThemePickerCard for its
 * swatch PREVIEW (so the preview under `system` mode resolves the exact same variant the apply will use;
 * two copies could drift on the media query or the SSR default → the preview would lie, the coupling).
 * SSR-safe: `browser` is false on the server → `'light'` (the lightest-surface default).
 */
export function getSystemTheme(): 'light' | 'dark' {
	if (!browser) return 'light';
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Fallback PWA status-bar hex by mode — used only when the active theme's surface token cannot be resolved
 * or converted (an unknown theme id, or a token that does not parse as oklch). These are the historical
 * hard-coded brand tints, so the meta is never blank.
 */
const FALLBACK_THEME_COLOR = { light: '#2563eb', dark: '#1a1a2e' } as const;

/**
 * Each theme's `background` token, pre-converted to hex, by id and resolved mode.
 *
 * This is the ONLY theme token value this store needs: the status bar should blend with the page
 * surface, and browser chrome does not reliably honor a raw `oklch()` in the meta. Painting is done
 * entirely by the generated themes.css, so importing THEME_REGISTRY here — on the root layout's
 * path, hence every route — would put every token value of every theme on the critical path to
 * produce one address-bar colour.
 *
 * theme-background-hex.test.ts holds this map to the registry: it fails if a theme is added or
 * removed, or if any theme's `background` token changes, so the two cannot silently drift.
 */
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

/**
 * Resolve the PWA `theme-color` hex for the ACTIVE theme + resolved mode. An unknown id falls back
 * to `default` (mirroring the graceful degrade the CSS does for an unmatched data-theme); a missing
 * entry falls back to the mode hex — so the meta always carries a valid color.
 */
function resolveThemeColor(themeId: string, resolved: 'light' | 'dark'): string {
	const theme = THEME_BACKGROUND_HEX[themeId] ?? THEME_BACKGROUND_HEX[DEFAULT_THEME_ID];
	return theme?.[resolved] ?? FALLBACK_THEME_COLOR[resolved];
}

/**
 * Apply BOTH theme axes to <html>: the light/dark `mode` (the `dark` class + the PWA theme-color meta) and
 * the theme `id` (the `data-theme` attribute that selects a themes.css block). `default` clears data-theme
 * so app.css's bare :root/.dark serves the identity theme (no redundant attribute). Idempotent.
 */
function applyTheme(preference: ThemePreference, themeId: string = getStoredThemeId()) {
	if (!browser) return;
	const resolved = preference === 'system' ? getSystemTheme() : preference;
	const root = document.documentElement;
	root.classList.toggle('dark', resolved === 'dark');

	// Theme-id axis: a non-default id sets data-theme (→ the themes.css override); default removes it.
	if (themeId && themeId !== DEFAULT_THEME_ID) {
		root.setAttribute('data-theme', themeId);
	} else {
		root.removeAttribute('data-theme');
	}

	// PWA status-bar tint: driven by the ACTIVE theme's surface colour for the resolved mode, so the
	// address bar matches the theme the user picked — not a fixed brand hex. Browser chrome is not
	// shot.sh-capturable, so this update is unit-tested instead (the eyes-on of the live address-bar
	// tint is a manual follow-up, not a CI gate).
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta) {
		meta.setAttribute('content', resolveThemeColor(themeId, resolved));
	}
}

/**
 * Push the selected theme id to the server (T9, D2 — synced for cross-device correctness). FAIL-SOFT: a
 * network/auth error is swallowed (logged in dev only) so it can NEVER blank or revert the theme the user
 * just picked — the local mirror is the source of truth for the active session; the server is best-effort
 * durability. Not awaited by setTheme (the UI re-skins instantly; the sync rides in the background).
 */
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

		/** The active theme id (the `id` axis, orthogonal to `current`'s light/dark mode). */
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
						// Re-resolve against the OS, preserving the active theme id.
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

		/**
		 * Switch the theme ID axis (the registry theme). Persists the `vroom-theme-id` mirror and re-applies
		 * with the CURRENT mode so the active light/dark variant is preserved. An unknown id is still
		 * stored + applied — the resolver/CSS treat an unmatched data-theme as the default look (R8), so a
		 * stale id degrades gracefully rather than throwing.
		 */
		setTheme(id: string) {
			if (browser) {
				localStorage.setItem(THEME_ID_KEY, id);
			}
			themeId = id;
			applyTheme(current, id);
			// Sync to the server (fail-soft) so the choice follows the user across devices (T9/D2).
			persistThemeToServer(id);
		},

		/**
		 * Reconcile the persisted theme id against the SERVER value on settings hydrate (T9/D2). Server wins
		 * for cross-device correctness: if the server's themePreference differs from the local mirror, adopt
		 * it (update the mirror + re-apply) — but do NOT re-push (the server already has it; that's the whole
		 * point of server-wins). A no-op when they already agree or the server value is absent/empty. Called
		 * from settingsStore.load() (root layout) after the settings fetch.
		 */
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
