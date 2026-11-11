/**
 * The theme store carries its OWN copy of two things the theme registry owns: the default theme id,
 * and each theme's `background` token pre-converted to hex for the PWA `theme-color` meta.
 *
 * It copies them on purpose. theme.svelte.ts is initialized by the root layout, so whatever it
 * imports is on EVERY route's critical path — and importing THEME_REGISTRY for one colour drags
 * every token value of every theme along (measured: 28.9 KB raw / 4.9 KB gzip in the root chunk).
 * Painting is done by the generated themes.css, not by the JS values.
 *
 * The cost of that copy is drift: add a theme, or retune one's `background`, and the address-bar
 * tint silently keeps the old colour with nothing going red. These tests are the lockstep — they
 * read the registry (the source of truth) and the store's literals, and assert they agree on the
 * theme set, on every hex, and on the default id.
 */

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_THEME_ID, THEME_REGISTRY } from '$lib/theme/theme-registry';
import { oklchToHex } from '$lib/theme/oklch-to-hex';

const STORE_PATH = `${process.cwd()}/src/lib/stores/theme.svelte.ts`;
const STORE_SRC = readFileSync(STORE_PATH, 'utf8');

/**
 * Parse the store's `THEME_BACKGROUND_HEX` literal out of its source. Read from the TEXT rather
 * than by importing the store: the map is module-private (it has no business being public), and a
 * test that imported it could only compare it with itself.
 */
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

/** Parse the store's own DEFAULT_THEME_ID literal. */
function storeDefaultThemeId(): string {
	return STORE_SRC.match(/const DEFAULT_THEME_ID\s*=\s*'([^']+)'/)?.[1] ?? '';
}

describe('theme store background-hex map mirrors the theme registry', () => {
	test('covers EXACTLY the registry theme set — no theme added or removed without updating it', () => {
		expect(Object.keys(storeBackgroundHex()).sort()).toEqual(Object.keys(THEME_REGISTRY).sort());
	});

	test('every hex equals oklchToHex of that theme variant`s background token', () => {
		const stored = storeBackgroundHex();
		for (const [id, definition] of Object.entries(THEME_REGISTRY)) {
			for (const variant of ['light', 'dark'] as const) {
				const expected = oklchToHex(definition[variant].background);
				expect(expected, `${id}.${variant}.background converts to a hex`).toBeTruthy();
				expect(stored[id]?.[variant], `${id}.${variant} background hex`).toBe(expected);
			}
		}
	});

	test('the store`s DEFAULT_THEME_ID literal equals the registry export', () => {
		expect(storeDefaultThemeId()).toBe(DEFAULT_THEME_ID);
	});

	test('the store does NOT import the token registry (it is on every route`s critical path)', () => {
		// The point of the copy. If a future edit re-adds this import the bytes come straight back,
		// and the map above becomes pure duplication — so fail rather than quietly regress.
		expect(STORE_SRC).not.toMatch(/from\s+'\$lib\/theme\/theme-registry'/);
		expect(STORE_SRC).not.toMatch(/from\s+'\$lib\/theme\/oklch-to-hex'/);
	});
});
