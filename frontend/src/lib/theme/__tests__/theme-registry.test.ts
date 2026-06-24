/**
 * Theming engine T5 guard — THEME_REGISTRY integrity + the `default` ≡ app.css identity contract.
 *
 * Two invariants:
 *   1. DEFAULT IS app.css: the `default` theme's light/dark token maps equal the live `src/app.css`
 *      `:root` / `.dark` declarations VALUE-FOR-VALUE. This is what makes `default` a zero-visual-change
 *      identity theme (R1) — and catches baseline drift: an app.css color edit not mirrored in the
 *      registry (or vice-versa) trips this. Source-of-truth: app.css is parsed at test time, not hardcoded.
 *   2. NO MISSING-KEY LEAK: every ThemeDefinition declares EVERY THEME_TOKEN_KEY in BOTH variants. A
 *      partial variant would leave a token at the previously-applied theme's value when switched (a visual
 *      leak) — the resolver/emitter assume a complete map. Applies to `default` today and to every future
 *      theme automatically.
 *
 * Pure source-scan + registry reflection — no DOM, no runtime apply.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { DEFAULT_THEME_ID, THEME_REGISTRY } from '../theme-registry';
import { THEME_TOKEN_KEYS, type ThemeTokenKey, type ThemeTokens } from '../theme-types';

const APP_CSS = readFileSync(`${process.cwd()}/src/app.css`, 'utf8');

/** Parse a `<selector> { ... }` block's `--token: value;` declarations into a key→value map (no `--`). */
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

describe('THEME_REGISTRY integrity + default ≡ app.css (T5)', () => {
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

  describe.each(Object.values(THEME_REGISTRY))('theme "$id"', (theme) => {
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
});
