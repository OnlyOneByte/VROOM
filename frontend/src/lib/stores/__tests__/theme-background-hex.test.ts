import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_THEME_ID, THEME_REGISTRY } from '$lib/theme/theme-registry';
import { oklchToHex } from '$lib/theme/oklch-to-hex';

const STORE_PATH = `${process.cwd()}/src/lib/stores/theme.svelte.ts`;
const STORE_SRC = readFileSync(STORE_PATH, 'utf8');

function storeBackgroundHex(): Record<string, { light: string; dark: string }> {
	const body = STORE_SRC.match(/const THEME_BACKGROUND_HEX:[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1];
	expect(body, 'THEME_BACKGROUND_HEX literal is parseable from the store source').toBeTruthy();

	const entries: Record<string, { light: string; dark: string }> = {};
	const row = /(\w[\w-]*):\s*\{\s*light:\s*'(#[0-9a-f]{6})',\s*dark:\s*'(#[0-9a-f]{6})'\s*\}/g;
	for (const match of (body as string).matchAll(row)) {
		entries[match[1] as string] = { light: match[2] as string, dark: match[3] as string };
	}
	return entries;
}

function storeDefaultThemeId(): string {
	return STORE_SRC.match(/const DEFAULT_THEME_ID\s*=\s*'([^']+)'/)?.[1] ?? '';
}

describe('theme store background-hex map mirrors the theme registry', () => {
	test('covers exactly the registry theme set', () => {
		expect(Object.keys(storeBackgroundHex()).sort()).toEqual(Object.keys(THEME_REGISTRY).sort());
	});

	test('every hex equals oklchToHex of the theme variant background token', () => {
		const stored = storeBackgroundHex();
		for (const [id, definition] of Object.entries(THEME_REGISTRY)) {
			for (const variant of ['light', 'dark'] as const) {
				const expected = oklchToHex(definition[variant].background);
				expect(expected, `${id}.${variant}.background converts to a hex`).toBeTruthy();
				expect(stored[id]?.[variant], `${id}.${variant} background hex`).toBe(expected);
			}
		}
	});

	test('the store DEFAULT_THEME_ID literal equals the registry export', () => {
		expect(storeDefaultThemeId()).toBe(DEFAULT_THEME_ID);
	});

	test('the store does not import the token registry', () => {
		expect(STORE_SRC).not.toMatch(/from\s+'\$lib\/theme\/theme-registry'/);
		expect(STORE_SRC).not.toMatch(/from\s+'\$lib\/theme\/oklch-to-hex'/);
	});
});
