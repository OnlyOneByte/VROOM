import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_THEME_ID, THEME_REGISTRY } from '$lib/theme/theme-registry';
import { oklchToHex } from '$lib/theme/oklch-to-hex';
import { generateThemeChromeModule } from '$lib/theme/themes-css';

vi.mock('$lib/services/settings-api', () => ({
	settingsApi: { updateSettings: vi.fn(() => Promise.resolve()) }
}));

const { themeStore } = await import('../theme.svelte');

const CWD = process.cwd();

function themeColor(): string | null {
	return document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null;
}

describe('theme-chrome.ts is generated from the theme registry', () => {
	test('the committed theme-chrome.ts equals generateThemeChromeModule(THEME_REGISTRY) byte-for-byte', () => {
		const committed = readFileSync(`${CWD}/src/lib/theme/theme-chrome.ts`, 'utf8');
		expect(
			committed,
			'theme-chrome.ts is stale: write generateThemeChromeModule(THEME_REGISTRY, DEFAULT_THEME_ID) to it'
		).toBe(generateThemeChromeModule(THEME_REGISTRY, DEFAULT_THEME_ID));
	});

	test('the theme store reads the generated module, not the token registry', () => {
		const storeSrc = readFileSync(`${CWD}/src/lib/stores/theme.svelte.ts`, 'utf8');
		expect(storeSrc).toMatch(/from\s+['"]\$lib\/theme\/theme-chrome['"]/);
		expect(storeSrc).not.toMatch(/from\s+['"][^'"]*theme-registry['"]/);
		expect(storeSrc).not.toMatch(/from\s+['"][^'"]*oklch-to-hex['"]/);
	});
});

describe('the theme-color meta tracks every registry theme background', () => {
	beforeEach(() => {
		localStorage.clear();
		let meta = document.querySelector('meta[name="theme-color"]');
		if (!meta) {
			meta = document.createElement('meta');
			meta.setAttribute('name', 'theme-color');
			document.head.appendChild(meta);
		}
		meta.setAttribute('content', '');
	});

	for (const [id, definition] of Object.entries(THEME_REGISTRY)) {
		for (const variant of ['light', 'dark'] as const) {
			test(`${id} (${variant}) sets the meta to that variant's background hex`, () => {
				themeStore.setPreference(variant);
				themeStore.setTheme(id);
				expect(themeColor()).toBe(oklchToHex(definition[variant].background));
			});
		}
	}

	test('an unknown id falls back to the default theme background', () => {
		themeStore.setPreference('dark');
		themeStore.setTheme('no-such-theme');
		const fallback = THEME_REGISTRY[DEFAULT_THEME_ID]?.dark.background ?? '';
		expect(themeColor()).toBe(oklchToHex(fallback));
	});
});
