import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'vroom-theme-preference';

function getStoredPreference(): ThemePreference {
	if (!browser) return 'system';
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
	return 'system';
}

function getSystemTheme(): 'light' | 'dark' {
	if (!browser) return 'light';
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(preference: ThemePreference) {
	if (!browser) return;
	const resolved = preference === 'system' ? getSystemTheme() : preference;
	const root = document.documentElement;
	root.classList.toggle('dark', resolved === 'dark');

	// Update theme-color meta tag for mobile browsers
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta) {
		meta.setAttribute('content', resolved === 'dark' ? '#1a1a2e' : '#2563eb');
	}
}

function createThemeStore() {
	const initial = getStoredPreference();
	const { subscribe, set } = writable<ThemePreference>(initial);

	return {
		subscribe,

		initialize() {
			const preference = getStoredPreference();
			applyTheme(preference);
			set(preference);

			// Listen for system theme changes
			if (browser) {
				window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
					const current = getStoredPreference();
					if (current === 'system') {
						applyTheme('system');
					}
				});
			}
		},

		setPreference(preference: ThemePreference) {
			if (browser) {
				localStorage.setItem(STORAGE_KEY, preference);
			}
			applyTheme(preference);
			set(preference);
		}
	};
}

export const themeStore = createThemeStore();
