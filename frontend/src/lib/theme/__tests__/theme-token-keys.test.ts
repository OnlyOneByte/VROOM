import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { THEME_TOKEN_KEYS } from '../theme-types';

const APP_CSS = readFileSync(`${process.cwd()}/src/app.css`, 'utf8');

function declaredTokenKeys(selector: string): Set<string> {
	const re = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`);
	const body = APP_CSS.match(re)?.[1] ?? '';
	const keys = new Set<string>();
	for (const m of body.matchAll(/^\s*--([a-z0-9-]+)\s*:/gim)) {
		const key = m[1];
		if (key) keys.add(key);
	}
	return keys;
}

const SHAPE_KEYS = new Set(['radius', 'r-sm', 'r-md', 'r-lg', 'r-xl', 'r-pill', 'shadow-pop']);

describe('THEME_TOKEN_KEYS mirrors the app.css per-variant token set', () => {
	const light = declaredTokenKeys(':root');
	const dark = declaredTokenKeys('.dark');
	const darkColors = new Set([...dark].filter(k => !SHAPE_KEYS.has(k)));

	test('the scan actually found tokens (non-vacuous)', () => {
		expect(light.size).toBeGreaterThan(20);
		expect(dark.size).toBeGreaterThan(20);
	});

	test('light (:root) and dark (.dark) declare the same colour key set', () => {
		const lightColors = new Set([...light].filter(k => !SHAPE_KEYS.has(k)));
		expect([...lightColors].sort()).toEqual([...darkColors].sort());
	});

	test('THEME_TOKEN_KEYS equals the .dark colour token set exactly', () => {
		expect([...THEME_TOKEN_KEYS].sort()).toEqual([...darkColors].sort());
	});

	test('the radius scale is declared once on :root and is not a themeable key', () => {
		for (const key of ['radius', 'r-sm', 'r-md', 'r-lg', 'r-xl', 'r-pill']) {
			expect(THEME_TOKEN_KEYS as readonly string[]).not.toContain(key);
			expect(light.has(key), `:root declares --${key}`).toBe(true);
			expect(dark.has(key), `.dark must not redeclare --${key}`).toBe(false);
		}
	});

	test('--shadow-pop is set for each mode and is not a colour token', () => {
		expect(light.has('shadow-pop')).toBe(true);
		expect(dark.has('shadow-pop')).toBe(true);
		expect(THEME_TOKEN_KEYS as readonly string[]).not.toContain('shadow-pop');
	});

	test('THEME_TOKEN_KEYS has no duplicates', () => {
		expect(new Set(THEME_TOKEN_KEYS).size).toBe(THEME_TOKEN_KEYS.length);
	});
});

describe('@theme inline color aliases reference only engine-managed tokens', () => {
	const themeBlock = APP_CSS.match(/@theme[^{]*\{([\s\S]*?)\}/)?.[1] ?? '';
	const aliasedRawTokens = new Set<string>();
	for (const m of themeBlock.matchAll(/--color-[a-z0-9-]+\s*:\s*var\(--([a-z0-9-]+)\)/gim)) {
		const raw = m[1];
		if (raw) aliasedRawTokens.add(raw);
	}
	const managed = new Set<string>(THEME_TOKEN_KEYS);

	test('the @theme color-alias scan is non-vacuous', () => {
		expect(aliasedRawTokens.size).toBeGreaterThan(20);
	});

	test('every --color-* alias points at a THEME_TOKEN_KEYS-managed raw token (no stale-alias leak)', () => {
		const unmanaged = [...aliasedRawTokens].filter(t => !managed.has(t));
		expect(
			unmanaged,
			`These Tailwind --color-* aliases reference raw tokens the theme engine does NOT manage — a theme ` +
				`switch would leave them STALE (a visual leak). Add each to THEME_TOKEN_KEYS + the registry, or ` +
				`point the alias at a managed token:\n  ${unmanaged.join(', ')}`
		).toEqual([]);
	});

	test('every managed token is exposed as a --color-* alias (no utility-less token)', () => {
		const unaliased = [...managed].filter(t => !aliasedRawTokens.has(t)).sort();
		expect(
			unaliased,
			`These engine-managed tokens have no \`--color-<token>: var(--<token>)\` alias in @theme inline, so ` +
				`the Tailwind utilities that name them emit NOTHING and the colour silently inherits. Add an ` +
				`alias for each:\n  ${unaliased.join(', ')}`
		).toEqual([]);
	});
});

describe('the shadcn accent utilities keep their hover meaning until the C3 kit lands', () => {
	const themeBlock = APP_CSS.match(/@theme[^{]*\{([\s\S]*?)\}/)?.[1] ?? '';
	const alias = (name: string) =>
		themeBlock.match(new RegExp(`--color-${name}\\s*:\\s*var\\(--([a-z0-9-]+)\\)`))?.[1];

	test('bg-accent paints the sunk surface, not the C3 accent colour', () => {
		expect(alias('accent')).toBe('sunk');
		expect(alias('accent-foreground')).toBe('foreground');
	});

	test('the C3 accent colour is reachable as accent-fill', () => {
		expect(alias('accent-fill')).toBe('accent');
		expect(alias('accent-fill-foreground')).toBe('accent-foreground');
	});
});
