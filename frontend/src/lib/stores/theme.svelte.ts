import { browser } from '$app/environment';
import { settingsApi } from '$lib/services/settings-api';
import { DEFAULT_THEME_ID } from '$lib/theme/theme-registry';

export type ThemePreference = 'light' | 'dark' | 'system';

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
 * two copies could drift on the media query or the SSR default → the preview would lie, the C348 coupling).
 * SSR-safe: `browser` is false on the server → `'light'` (the lightest-surface default).
 */
export function getSystemTheme(): 'light' | 'dark' {
	if (!browser) return 'light';
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
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

	// PWA status-bar tint. NOTE (T8): still the hard-coded brand hex by mode — migrating this to the
	// RESOLVED theme's brand token is a visible, browser-chrome change (uncapturable by shot.sh + an
	// oklch-in-meta compat question), flagged to Angelo as a design sub-part. Mode-correct today.
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta) {
		meta.setAttribute('content', resolved === 'dark' ? '#1a1a2e' : '#2563eb');
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
	settingsApi.updateSettings({ themePreference: id }).catch((err) => {
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
