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

	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta) {
		meta.setAttribute('content', resolved === 'dark' ? '#1a1a2e' : '#2563eb');
	}
}

function createThemeStore() {
	let current = $state<ThemePreference>(getStoredPreference());

	return {
		get current() {
			return current;
		},

		initialize() {
			const preference = getStoredPreference();
			applyTheme(preference);
			current = preference;

			if (browser) {
				window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
					const stored = getStoredPreference();
					if (stored === 'system') {
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
			current = preference;
		}
	};
}

export const themeStore = createThemeStore();
