/**
 * Theming engine T7 — themes.css generator + the checked-in-file freshness guard.
 *
 * Two concerns:
 *   1. GENERATOR CORRECTNESS: for a non-default theme, emit `:root[data-theme="<id>"]` (light) +
 *      `:root[data-theme="<id>"].dark` (dark) blocks declaring EVERY token. Driven with a synthetic theme
 *      so the structure is pinned even while the real registry has only `default` (which is excluded —
 *      app.css owns its bare :root/.dark).
 *   2. CHECKED-IN FRESHNESS: the committed `themes.css` must equal `generateThemesCss(THEME_REGISTRY)`
 *      byte-for-byte. So adding/removing a registry theme without regenerating the file trips this — the
 *      file can't silently drift from the registry (the C25/C170 source-scan idiom, applied to a codegen
 *      artifact). And it pins that the generated file covers exactly the non-default registry ids.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { DEFAULT_THEME_ID, THEME_REGISTRY } from '../theme-registry';
import type { ThemeDefinition, ThemeTokens } from '../theme-types';
import { generateThemesCss, nonDefaultThemeIds, themeBlocks } from '../themes-css';
import { THEME_TOKEN_KEYS } from '../theme-types';

/** A complete synthetic token map (every key present), value = the key name (enough to assert presence). */
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
  dark: fullTokens('D'),
};

describe('themes.css generator (T7)', () => {
  test('themeBlocks emits a light + a dark[data-theme].dark selector for a theme', () => {
    const css = themeBlocks(SYNTHETIC);
    expect(css).toContain(':root[data-theme="synthetic"] {');
    expect(css).toContain(':root[data-theme="synthetic"].dark {');
  });

  test('every token key appears in both the light and dark block', () => {
    const css = themeBlocks(SYNTHETIC);
    for (const key of THEME_TOKEN_KEYS) {
      // light value L-<key>, dark value D-<key>
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
    // default must NOT get a data-theme block — app.css owns its bare :root/.dark.
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
    const reg = { default: THEME_REGISTRY[DEFAULT_THEME_ID] as ThemeDefinition, synthetic: SYNTHETIC };
    expect(generateThemesCss(reg, DEFAULT_THEME_ID)).toBe(generateThemesCss(reg, DEFAULT_THEME_ID));
  });
});

describe('checked-in themes.css is in sync with the registry (T7 freshness guard)', () => {
  const committed = readFileSync(`${process.cwd()}/src/lib/theme/themes.css`, 'utf8');

  test('the committed themes.css equals generateThemesCss(THEME_REGISTRY) byte-for-byte', () => {
    // If this fails: a registry theme was added/changed without regenerating themes.css.
    // Regenerate it from THEME_REGISTRY (see themes-css.ts) and commit.
    expect(committed).toBe(generateThemesCss(THEME_REGISTRY, DEFAULT_THEME_ID));
  });

  test('the committed file covers exactly the non-default registry ids', () => {
    for (const id of nonDefaultThemeIds(THEME_REGISTRY, DEFAULT_THEME_ID)) {
      expect(committed).toContain(`:root[data-theme="${id}"]`);
    }
  });
});
