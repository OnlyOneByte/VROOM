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

  // TWO non-default themes given OUT of id-order: both generateThemesCss (block order) and
  // nonDefaultThemeIds must emit them id-SORTED. This drives the `.sort((a,b) => a.id.localeCompare(b.id))`
  // comparator in BOTH functions (themes-css.ts:50/65) — the existing single-SYNTHETIC tests never compare
  // two elements, so the comparator was uncovered (the C250/C251 reachable-branch pattern; no `instrument`
  // / no DB / no gate needed). A regression to insertion-order or a reversed comparator turns this RED.
  test('multiple non-default themes are emitted id-sorted (the comparator fires with ≥2)', () => {
    const zz: ThemeDefinition = { ...SYNTHETIC, id: 'zztheme', label: 'ZZ' };
    const aa: ThemeDefinition = { ...SYNTHETIC, id: 'aatheme', label: 'AA' };
    // Registry insertion order is zz BEFORE aa — output must still be aa BEFORE zz.
    const reg = {
      default: THEME_REGISTRY[DEFAULT_THEME_ID] as ThemeDefinition,
      zztheme: zz,
      aatheme: aa,
    };
    expect(nonDefaultThemeIds(reg, DEFAULT_THEME_ID)).toEqual(['aatheme', 'zztheme']);
    const css = generateThemesCss(reg, DEFAULT_THEME_ID);
    expect(css.indexOf('data-theme="aatheme"')).toBeLessThan(css.indexOf('data-theme="zztheme"'));
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

/**
 * WIRING GUARD — the root layout must IMPORT themes.css, else the generated `:root[data-theme="<id>"]`
 * blocks are never in the bundle and EVERY non-default theme silently renders as default (the head-script
 * sets `data-theme`, but no matching CSS exists to key into). This is invisible to every other theming
 * guard: byte-freshness (the file is fine), registry-integrity (the registry is fine), contrast +
 * distinctness (the token values are fine) — all stay GREEN while themes are dead in the running app. The
 * only thing standing between "registered" and "actually paints" is this one import line; pin it (the
 * C190/C201 cross-file source-scan idiom on the layout↔css coupling). app.css is checked as the sibling
 * (both are load-bearing layout-level imports; losing either is a visual regression no unit test sees).
 */
describe('themes.css is wired into the app via the root layout (T7 wiring guard)', () => {
  const LAYOUT = readFileSync(`${process.cwd()}/src/routes/+layout.svelte`, 'utf8');

  test('+layout.svelte imports the generated themes.css', () => {
    // A drop of this line ships every non-default theme as a silent default clone in the real app.
    expect(LAYOUT).toMatch(/import\s+['"]\$lib\/theme\/themes\.css['"]/);
  });

  test('+layout.svelte still imports app.css (the default look the bare :root serves)', () => {
    expect(LAYOUT).toMatch(/import\s+['"][.\/]*app\.css['"]/);
  });
});
