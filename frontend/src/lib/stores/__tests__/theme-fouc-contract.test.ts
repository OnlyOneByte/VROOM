// Pins the anti-FOUC head script in app.html to the theme store's constants; that script is raw HTML the unit tests cannot see.

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { DEFAULT_THEME_ID } from '$lib/theme/theme-registry';

const CWD = process.cwd();
const APP_HTML = readFileSync(`${CWD}/src/app.html`, 'utf8');
const STORE_SRC = readFileSync(`${CWD}/src/lib/stores/theme.svelte.ts`, 'utf8');

function storeStorageKey(): string {
	const m = STORE_SRC.match(/const STORAGE_KEY\s*=\s*['"]([^'"]+)['"]/);
	return m?.[1] ?? '';
}

function storeThemeIdKey(): string {
	const m = STORE_SRC.match(/const THEME_ID_KEY\s*=\s*['"]([^'"]+)['"]/);
	return m?.[1] ?? '';
}

describe('app.html anti-FOUC head-script mirrors the theme store', () => {
	test('the head-script reads the SAME localStorage key the store writes', () => {
		const key = storeStorageKey();
		expect(key, 'store STORAGE_KEY is parseable').toBeTruthy();
		expect(APP_HTML).toContain(`localStorage.getItem('${key}')`);
		expect(STORE_SRC).toContain(`localStorage.getItem(STORAGE_KEY)`);
		expect(STORE_SRC).toContain(`localStorage.setItem(STORAGE_KEY, preference)`);
	});

	test('the head-script toggles the SAME `dark` class the store toggles on <html>', () => {
		expect(STORE_SRC).toMatch(/classList\.toggle\(\s*['"]dark['"]/);
		expect(APP_HTML).toMatch(/classList\.add\(\s*['"]dark['"]\s*\)/);
	});

	test('the head-script resolves `system` via the SAME prefers-color-scheme query the store uses', () => {
		const QUERY = '(prefers-color-scheme: dark)';
		expect(STORE_SRC).toContain(QUERY);
		expect(APP_HTML).toContain(QUERY);
	});

	test('the head-script honors the `system` sentinel (the store default when unset)', () => {
		expect(STORE_SRC).toContain("return 'system'");
		expect(APP_HTML).toContain("=== 'system'");
		expect(APP_HTML).toMatch(/\|\|\s*['"]system['"]/);
	});
});

describe('app.html head-script pre-paints the theme-id axis', () => {
	test('the head-script reads the SAME theme-id mirror key the store writes', () => {
		const key = storeThemeIdKey();
		expect(key, 'store THEME_ID_KEY is parseable').toBeTruthy();
		expect(STORE_SRC).toContain('localStorage.getItem(THEME_ID_KEY)');
		expect(STORE_SRC).toContain('localStorage.setItem(THEME_ID_KEY, id)');
		expect(APP_HTML).toContain(`localStorage.getItem('${key}')`);
	});

	test('the head-script sets data-theme on <html> (mirrors applyTheme)', () => {
		expect(STORE_SRC).toMatch(/setAttribute\(\s*['"]data-theme['"]/);
		expect(APP_HTML).toMatch(/setAttribute\(\s*['"]data-theme['"]/);
	});

	test('the head-script treats the DEFAULT_THEME_ID sentinel as "no override" (no data-theme set)', () => {
		expect(STORE_SRC).toMatch(/themeId\s*!==\s*DEFAULT_THEME_ID/);
		expect(APP_HTML).toContain(`!== '${DEFAULT_THEME_ID}'`);
		expect(APP_HTML).toMatch(new RegExp(`\\|\\|\\s*['"]${DEFAULT_THEME_ID}['"]`));
	});
});
