import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { DEFAULT_THEME_ID, THEME_REGISTRY } from '../theme-registry';
import type { ThemeDefinition, ThemeTokens } from '../theme-types';
import { generateThemesCss, nonDefaultThemeIds, themeBlocks } from '../themes-css';
import { THEME_TOKEN_KEYS } from '../theme-types';

function fullTokens(prefix: string): ThemeTokens {
	const t = {} as ThemeTokens;
	for (const k of THEME_TOKEN_KEYS) t[k] = `${prefix}-${k}`;
	return t;
}

const SYNTHETIC: ThemeDefinition = {
	id: 'synthetic',
	label: 'Synthetic',
	description: 'test-only',
	swatch: ['primary'],
	source: 'builtin',
	light: fullTokens('L'),
	dark: fullTokens('D')
};

describe('themes.css generator', () => {
	test('themeBlocks emits a light + a dark[data-theme].dark selector for a theme', () => {
		const css = themeBlocks(SYNTHETIC);
		expect(css).toContain(':root[data-theme="synthetic"] {');
		expect(css).toContain(':root[data-theme="synthetic"].dark {');
	});

	test('every token key appears in both the light and dark block', () => {
		const css = themeBlocks(SYNTHETIC);
		for (const key of THEME_TOKEN_KEYS) {
			expect(css).toContain(`--${key}: L-${key};`);
			expect(css).toContain(`--${key}: D-${key};`);
		}
	});

	test('generateThemesCss includes a non-default theme and EXCLUDES default', () => {
		const css = generateThemesCss(
			{ default: THEME_REGISTRY[DEFAULT_THEME_ID] as ThemeDefinition, synthetic: SYNTHETIC },
			DEFAULT_THEME_ID
		);
		expect(css).toContain(':root[data-theme="synthetic"]');
		expect(css).not.toContain('data-theme="default"');
	});

	test('a registry with only default produces no theme blocks (placeholder only)', () => {
		const css = generateThemesCss(
			{ default: THEME_REGISTRY[DEFAULT_THEME_ID] as ThemeDefinition },
			DEFAULT_THEME_ID
		);
		expect(css).not.toContain('data-theme=');
		expect(css).toContain('No non-default themes');
	});

	test('output is deterministic (stable across regenerations)', () => {
		const reg = {
			default: THEME_REGISTRY[DEFAULT_THEME_ID] as ThemeDefinition,
			synthetic: SYNTHETIC
		};
		expect(generateThemesCss(reg, DEFAULT_THEME_ID)).toBe(generateThemesCss(reg, DEFAULT_THEME_ID));
	});

	test('multiple non-default themes are emitted id-sorted (the comparator fires with ≥2)', () => {
		const zz: ThemeDefinition = { ...SYNTHETIC, id: 'zztheme', label: 'ZZ' };
		const aa: ThemeDefinition = { ...SYNTHETIC, id: 'aatheme', label: 'AA' };
		const reg = {
			default: THEME_REGISTRY[DEFAULT_THEME_ID] as ThemeDefinition,
			zztheme: zz,
			aatheme: aa
		};
		expect(nonDefaultThemeIds(reg, DEFAULT_THEME_ID)).toEqual(['aatheme', 'zztheme']);
		const css = generateThemesCss(reg, DEFAULT_THEME_ID);
		expect(css.indexOf('data-theme="aatheme"')).toBeLessThan(css.indexOf('data-theme="zztheme"'));
	});
});

describe('checked-in themes.css is in sync with the registry', () => {
	const committed = readFileSync(`${process.cwd()}/src/lib/theme/themes.css`, 'utf8');

	test('the committed themes.css equals generateThemesCss(THEME_REGISTRY) byte-for-byte', () => {
		expect(committed).toBe(generateThemesCss(THEME_REGISTRY, DEFAULT_THEME_ID));
	});

	test('the committed file covers exactly the non-default registry ids', () => {
		for (const id of nonDefaultThemeIds(THEME_REGISTRY, DEFAULT_THEME_ID)) {
			expect(committed).toContain(`:root[data-theme="${id}"]`);
		}
	});
});

describe('themes.css is wired into the app via the root layout', () => {
	const LAYOUT = readFileSync(`${process.cwd()}/src/routes/+layout.svelte`, 'utf8');

	test('+layout.svelte imports the generated themes.css', () => {
		expect(LAYOUT).toMatch(/import\s+['"]#lib\/theme\/themes\.css['"]/);
	});

	test('+layout.svelte still imports app.css (the default look the bare :root serves)', () => {
		expect(LAYOUT).toMatch(/import\s+['"][./]*app\.css['"]/);
	});
});

describe('ThemePickerCard is mounted on the settings route', () => {
	const SETTINGS = readFileSync(`${process.cwd()}/src/routes/settings/+page.svelte`, 'utf8');

	test('settings/+page.svelte imports ThemePickerCard', () => {
		expect(SETTINGS).toMatch(
			/import\s+ThemePickerCard\s+from\s+['"]#lib\/components\/settings\/cards\/ThemePickerCard\.svelte['"]/
		);
	});

	test('settings/+page.svelte renders the <ThemePickerCard /> tag', () => {
		expect(SETTINGS).toMatch(/<ThemePickerCard\s*\/>/);
	});
});

describe('ThemePickerCard swatch loop is keyed crash-safely (index, not color)', () => {
	const PICKER = readFileSync(
		`${process.cwd()}/src/lib/components/settings/cards/ThemePickerCard.svelte`,
		'utf8'
	);

	test('the swatch {#each} keys by index, not by the (possibly-duplicate) color value', () => {
		expect(PICKER).toMatch(/#each\s+swatchColors\(theme\)\s+as\s+color\s*,\s*i\s*\(i\)/);
		expect(PICKER).not.toMatch(/#each\s+swatchColors\(theme\)\s+as\s+color\s*\(color\)/);
	});
});

describe('ThemePickerCard swatch previews follow the active variant', () => {
	const PICKER = readFileSync(
		`${process.cwd()}/src/lib/components/settings/cards/ThemePickerCard.svelte`,
		'utf8'
	);

	test('swatchColors indexes the DYNAMIC variant (theme[variant]), not a hardcoded theme.light/theme.dark', () => {
		expect(PICKER).toMatch(/const\s+tokens\s*=\s*theme\[variant\]/);
		expect(PICKER).not.toMatch(/const\s+tokens\s*=\s*theme\.(light|dark)\b/);
	});

	test('the variant is derived from resolveVariant over the active mode (not a constant)', () => {
		expect(PICKER).toMatch(/variant\s*=\s*\$derived\(\s*resolveVariant\(\s*mode\s*,/);
		expect(PICKER).toMatch(/mode\s*=\s*\$derived\(\s*themeStore\.current\s*\)/);
		expect(PICKER).toMatch(/resolveVariant\(\s*mode\s*,\s*getSystemTheme\(\)\s*\)/);
	});
});
