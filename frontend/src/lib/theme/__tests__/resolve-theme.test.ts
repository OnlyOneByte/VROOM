import { describe, expect, test } from 'vitest';
import { resolveTheme, resolveThemeDefinition, resolveVariant } from '../resolve-theme';
import { DEFAULT_THEME_ID, THEME_REGISTRY } from '../theme-registry';
import { THEME_TOKEN_KEYS } from '../theme-types';

const DEFAULT = THEME_REGISTRY[DEFAULT_THEME_ID];

describe('resolveTheme', () => {
	test('every built-in theme resolves to its own light/dark variant', () => {
		for (const [id, def] of Object.entries(THEME_REGISTRY)) {
			expect(resolveTheme(id, 'light', 'light')).toEqual(def.light);
			expect(resolveTheme(id, 'dark', 'dark')).toEqual(def.dark);
		}
	});

	test('mode "system" follows the OS preference', () => {
		expect(resolveTheme('default', 'system', 'dark')).toEqual(DEFAULT?.dark);
		expect(resolveTheme('default', 'system', 'light')).toEqual(DEFAULT?.light);
	});

	test('explicit light/dark mode ignores the OS preference', () => {
		expect(resolveTheme('default', 'light', 'dark')).toEqual(DEFAULT?.light);
		expect(resolveTheme('default', 'dark', 'light')).toEqual(DEFAULT?.dark);
	});

	test('an unknown theme id falls back to default', () => {
		expect(resolveTheme('no-such-theme', 'light', 'light')).toEqual(DEFAULT?.light);
		expect(resolveTheme('no-such-theme', 'dark', 'dark')).toEqual(DEFAULT?.dark);
	});

	test('empty / null / garbage ids and modes never throw and yield a complete token map', () => {
		const inputs: Array<[unknown, unknown, unknown]> = [
			['', '', ''],
			[null, null, null],
			[undefined, undefined, undefined],
			['💥', 'sideways', 'mauve'],
			['default', 'system', undefined]
		];
		for (const [id, mode, sys] of inputs) {
			// biome-ignore lint/suspicious/noExplicitAny: deliberately feeding malformed inputs to prove totality
			const tokens = resolveTheme(id as any, mode as any, sys as any);
			for (const key of THEME_TOKEN_KEYS) {
				expect(tokens[key], `${String(id)}/${String(mode)} missing ${key}`).toBeTruthy();
			}
		}
	});

	test('garbage mode with no systemPref defaults to the LIGHT variant', () => {
		expect(resolveTheme('default', 'system', null)).toEqual(DEFAULT?.light);
		// biome-ignore lint/suspicious/noExplicitAny: malformed mode
		expect(resolveTheme('default', 'banana' as any, null)).toEqual(DEFAULT?.light);
	});
});

describe('resolveThemeDefinition', () => {
	test('returns the named definition when present', () => {
		expect(resolveThemeDefinition('default').id).toBe('default');
	});

	test('falls back to default for unknown/empty/null id', () => {
		expect(resolveThemeDefinition('nope').id).toBe('default');
		expect(resolveThemeDefinition('').id).toBe('default');
		expect(resolveThemeDefinition(null).id).toBe('default');
		expect(resolveThemeDefinition(undefined).id).toBe('default');
	});

	test('does not resolve inherited Object.prototype keys as theme ids (no prototype-pollution false hit)', () => {
		expect(resolveThemeDefinition('constructor').id).toBe('default');
		expect(resolveThemeDefinition('toString').id).toBe('default');
	});
});

describe('resolveVariant', () => {
	test('concrete modes pass through', () => {
		expect(resolveVariant('light', 'dark')).toBe('light');
		expect(resolveVariant('dark', 'light')).toBe('dark');
	});

	test('system follows OS pref; unknown pref → light', () => {
		expect(resolveVariant('system', 'dark')).toBe('dark');
		expect(resolveVariant('system', 'light')).toBe('light');
		expect(resolveVariant('system', null)).toBe('light');
		expect(resolveVariant('system', undefined)).toBe('light');
	});

	test('null/garbage mode → treated as system (→ light without a pref)', () => {
		expect(resolveVariant(null, null)).toBe('light');
		expect(resolveVariant(undefined, 'dark')).toBe('dark');
	});
});
