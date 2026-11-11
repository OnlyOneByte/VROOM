// Checks THEME_REGISTRY integrity, and that the default theme matches app.css.

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { DEFAULT_THEME_ID, THEME_REGISTRY } from '../theme-registry';
import {
	THEME_TOKEN_KEYS,
	type ThemeDefinition,
	type ThemeTokenKey,
	type ThemeTokens
} from '../theme-types';

const APP_CSS = readFileSync(`${process.cwd()}/src/app.css`, 'utf8');

function parseTokens(selector: string): Record<string, string> {
	const re = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`);
	const body = APP_CSS.match(re)?.[1] ?? '';
	const out: Record<string, string> = {};
	for (const m of body.matchAll(/^\s*--([a-z0-9-]+)\s*:\s*([^;]+);/gim)) {
		const key = m[1];
		const value = m[2];
		if (key && value) out[key] = value.trim();
	}
	return out;
}

describe('THEME_REGISTRY integrity and default matches app.css', () => {
	const cssLight = parseTokens(':root');
	const cssDark = parseTokens('.dark');

	test('the app.css parse is non-vacuous', () => {
		expect(Object.keys(cssLight).length).toBeGreaterThan(20);
		expect(Object.keys(cssDark).length).toBeGreaterThan(20);
	});

	test('the registry always contains the fallback default theme', () => {
		expect(THEME_REGISTRY[DEFAULT_THEME_ID]).toBeDefined();
		expect(THEME_REGISTRY[DEFAULT_THEME_ID]?.id).toBe('default');
	});

	describe.each(Object.values(THEME_REGISTRY))('theme "$id"', theme => {
		test('declares EVERY token key in both light and dark (no missing-key leak)', () => {
			for (const key of THEME_TOKEN_KEYS) {
				expect(theme.light[key as ThemeTokenKey], `${theme.id}.light missing ${key}`).toBeTruthy();
				expect(theme.dark[key as ThemeTokenKey], `${theme.id}.dark missing ${key}`).toBeTruthy();
			}
		});

		test('declares NO keys beyond THEME_TOKEN_KEYS (no stray token)', () => {
			const allowed = new Set<string>(THEME_TOKEN_KEYS);
			for (const variant of ['light', 'dark'] as const) {
				for (const key of Object.keys(theme[variant])) {
					expect(allowed.has(key), `${theme.id}.${variant} has stray key ${key}`).toBe(true);
				}
			}
		});
	});

	test('default.light equals app.css :root value-for-value (zero visual change)', () => {
		const def = THEME_REGISTRY['default']?.light as ThemeTokens;
		for (const key of THEME_TOKEN_KEYS) {
			expect(def[key], `default.light.${key} must match app.css :root`).toBe(cssLight[key]);
		}
	});

	test('default.dark equals app.css .dark value-for-value (zero visual change)', () => {
		const def = THEME_REGISTRY['default']?.dark as ThemeTokens;
		for (const key of THEME_TOKEN_KEYS) {
			expect(def[key], `default.dark.${key} must match app.css .dark`).toBe(cssDark[key]);
		}
	});

	const nonDefaultThemes = Object.values(THEME_REGISTRY).filter(t => t.id !== DEFAULT_THEME_ID);
	if (nonDefaultThemes.length > 0) {
		const defLight = THEME_REGISTRY[DEFAULT_THEME_ID]?.light as ThemeTokens;
		const defDark = THEME_REGISTRY[DEFAULT_THEME_ID]?.dark as ThemeTokens;
		describe.each(nonDefaultThemes)(
			'non-default theme "$id" is not a silent default clone',
			theme => {
				test('its LIGHT variant differs from default.light in at least one token', () => {
					const differs = THEME_TOKEN_KEYS.some(
						k => theme.light[k as ThemeTokenKey] !== defLight[k as ThemeTokenKey]
					);
					expect(
						differs,
						`${theme.id}.light is byte-identical to default.light (inert theme)`
					).toBe(true);
				});
				test('its DARK variant differs from default.dark in at least one token', () => {
					const differs = THEME_TOKEN_KEYS.some(
						k => theme.dark[k as ThemeTokenKey] !== defDark[k as ThemeTokenKey]
					);
					expect(differs, `${theme.id}.dark is byte-identical to default.dark (inert theme)`).toBe(
						true
					);
				});
			}
		);
	}

	describe.each(Object.values(THEME_REGISTRY))('theme "$id" picker metadata', theme => {
		test('has a non-empty label', () => {
			expect(theme.label.trim().length, `${theme.id} has an empty label`).toBeGreaterThan(0);
		});
		test('has a non-empty description', () => {
			expect(
				theme.description.trim().length,
				`${theme.id} has an empty description`
			).toBeGreaterThan(0);
		});
		test('has a non-empty swatch of valid token keys', () => {
			expect(theme.swatch.length, `${theme.id} has an empty swatch strip`).toBeGreaterThan(0);
			const allowed = new Set<string>(THEME_TOKEN_KEYS);
			for (const key of theme.swatch) {
				expect(allowed.has(key), `${theme.id} swatch references unknown token key ${key}`).toBe(
					true
				);
			}
		});
	});

	test('no two registered themes are byte-identical (all-pairs distinctness)', () => {
		const all = Object.values(THEME_REGISTRY);
		for (let i = 0; i < all.length; i++) {
			for (let j = i + 1; j < all.length; j++) {
				const a = all[i] as ThemeDefinition;
				const b = all[j] as ThemeDefinition;
				const sameLight = THEME_TOKEN_KEYS.every(
					k => a.light[k as ThemeTokenKey] === b.light[k as ThemeTokenKey]
				);
				const sameDark = THEME_TOKEN_KEYS.every(
					k => a.dark[k as ThemeTokenKey] === b.dark[k as ThemeTokenKey]
				);
				expect(
					sameLight && sameDark,
					`themes "${a.id}" and "${b.id}" are byte-identical (a clone — one was likely copy-pasted without editing its tokens)`
				).toBe(false);
			}
		}
	});

	const oklchL = (v: string): number => {
		const m = v.match(/oklch\(\s*([\d.]+)/);
		return m ? Number(m[1]) : Number.NaN;
	};
	describe.each(Object.values(THEME_REGISTRY))(
		'theme "$id" dark variant is darker than light',
		theme => {
			test('dark.background is darker than light.background', () => {
				const lightL = oklchL(theme.light.background);
				const darkL = oklchL(theme.dark.background);
				expect(
					Number.isNaN(lightL) || Number.isNaN(darkL),
					`${theme.id} background L unparseable`
				).toBe(false);
				expect(
					darkL,
					`${theme.id}: dark.background L (${darkL}) must be < light.background L (${lightL}) — variants likely swapped`
				).toBeLessThan(lightL);
			});
			test('dark.foreground is lighter than light.foreground (text inverts)', () => {
				const lightL = oklchL(theme.light.foreground);
				const darkL = oklchL(theme.dark.foreground);
				expect(
					darkL,
					`${theme.id}: dark.foreground L (${darkL}) must be > light.foreground L (${lightL}) — variants likely swapped`
				).toBeGreaterThan(lightL);
			});
		}
	);
});
