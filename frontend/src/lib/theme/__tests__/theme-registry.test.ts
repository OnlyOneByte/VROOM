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
import {
  THEME_TOKEN_KEYS,
  type ThemeDefinition,
  type ThemeTokenKey,
  type ThemeTokens,
} from '../theme-types';

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

  // A NON-default theme must actually DIFFER from `default` in BOTH variants — else it is a silent no-op
  // theme. This is a real footgun: each new ThemeDefinition is authored by copy-pasting the DEFAULT_LIGHT/
  // DEFAULT_DARK blocks and editing values (theme-registry.ts), so a registration that forgets to change
  // the values ships a theme the picker offers but that paints identically to default — and EVERY other
  // guard stays green (contrast passes: it IS default's known-AA palette; registry-integrity passes: all
  // keys present; css-freshness passes: a block is emitted). Nothing else catches "registered but inert".
  // Distinct = at least one token value differs (not necessarily all). Skips `default` itself.
  const nonDefaultThemes = Object.values(THEME_REGISTRY).filter((t) => t.id !== DEFAULT_THEME_ID);
  if (nonDefaultThemes.length > 0) {
    const defLight = THEME_REGISTRY[DEFAULT_THEME_ID]?.light as ThemeTokens;
    const defDark = THEME_REGISTRY[DEFAULT_THEME_ID]?.dark as ThemeTokens;
    describe.each(nonDefaultThemes)('non-default theme "$id" is not a silent default clone', (theme) => {
      test('its LIGHT variant differs from default.light in at least one token', () => {
        const differs = THEME_TOKEN_KEYS.some(
          (k) => theme.light[k as ThemeTokenKey] !== defLight[k as ThemeTokenKey]
        );
        expect(differs, `${theme.id}.light is byte-identical to default.light (inert theme)`).toBe(true);
      });
      test('its DARK variant differs from default.dark in at least one token', () => {
        const differs = THEME_TOKEN_KEYS.some(
          (k) => theme.dark[k as ThemeTokenKey] !== defDark[k as ThemeTokenKey]
        );
        expect(differs, `${theme.id}.dark is byte-identical to default.dark (inert theme)`).toBe(true);
      });
    });
  }

  // PICKER METADATA CONTRACT: the ThemePickerCard (C318) renders each theme's `label`, `description`, and
  // `swatch` strip. TypeScript types these as `string` / `ThemeTokenKey[]`, but `string` admits '' and an
  // array admits [] — a theme shipped with an empty label/description or an empty swatch renders a BLANK or
  // broken picker card (no name, no preview), and every other guard (contrast/distinctness/wiring/byte-
  // freshness) stays GREEN because they only inspect token VALUES, never the presentation metadata. This
  // pins the non-empty + valid-key contract for EVERY registered theme so a future palette (bento/…) with a
  // typo'd or omitted field trips here, not in the user's settings page.
  describe.each(Object.values(THEME_REGISTRY))('theme "$id" picker metadata', (theme) => {
    test('has a non-empty label', () => {
      expect(theme.label.trim().length, `${theme.id} has an empty label`).toBeGreaterThan(0);
    });
    test('has a non-empty description', () => {
      expect(theme.description.trim().length, `${theme.id} has an empty description`).toBeGreaterThan(0);
    });
    test('has a non-empty swatch of valid token keys', () => {
      expect(theme.swatch.length, `${theme.id} has an empty swatch strip`).toBeGreaterThan(0);
      const allowed = new Set<string>(THEME_TOKEN_KEYS);
      for (const key of theme.swatch) {
        expect(allowed.has(key), `${theme.id} swatch references unknown token key ${key}`).toBe(true);
      }
    });
  });

  // CROSS-THEME DISTINCTNESS (all pairs): the per-theme guard above only checks each theme vs `default`. It
  // would NOT catch two NON-default themes being byte-identical — e.g. a future palette registered by
  // copy-pasting an existing one and forgetting to edit the token maps (the steepest risk now: each new
  // theme IS authored by cloning a prior X_LIGHT/X_DARK block). Such a clone would ship two picker cards that
  // paint identically — green under contrast/metadata/byte-freshness (the values are individually valid) and
  // green under the vs-default guard (it differs from default, just not from its twin). This pins that EVERY
  // PAIR of registered themes differs in at least one token in at least one variant. Surfaced firsthand C325.
  test('no two registered themes are byte-identical (all-pairs distinctness)', () => {
    const all = Object.values(THEME_REGISTRY);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i] as ThemeDefinition;
        const b = all[j] as ThemeDefinition;
        const sameLight = THEME_TOKEN_KEYS.every(
          (k) => a.light[k as ThemeTokenKey] === b.light[k as ThemeTokenKey]
        );
        const sameDark = THEME_TOKEN_KEYS.every(
          (k) => a.dark[k as ThemeTokenKey] === b.dark[k as ThemeTokenKey]
        );
        expect(
          sameLight && sameDark,
          `themes "${a.id}" and "${b.id}" are byte-identical (a clone — one was likely copy-pasted without editing its tokens)`
        ).toBe(false);
      }
    }
  });
});
