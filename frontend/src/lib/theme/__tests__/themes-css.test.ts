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

/**
 * PICKER-MOUNT WIRING GUARD — the settings route must actually RENDER <ThemePickerCard />, else the entire
 * theming engine is user-UNREACHABLE (no way to pick a non-default theme) while EVERY other guard stays
 * green: registry-integrity (the registry is fine), themes.css byte-freshness + layout-import (the CSS is
 * fine), contrast/distinctness/metadata (the token values are fine), and even the picker component's own
 * logic tests (it renders fine — in isolation). This is the EXACT sibling of the themes.css↔+layout wiring
 * guard above: that pins the CSS reaches the bundle; this pins the picker reaches the page. The one mount
 * line on settings/+page.svelte (the `import` + the `<ThemePickerCard />` tag) is all that stands between
 * "engine built + CSS shipped" and "a user can switch themes" — drop it and the feature silently vanishes
 * from the UI with a fully-green suite. Pin both the import and the tag (the C190/C201 cross-file
 * source-scan idiom on the route↔component coupling).
 */
describe('ThemePickerCard is mounted on the settings route (picker-reachability guard)', () => {
  const SETTINGS = readFileSync(`${process.cwd()}/src/routes/settings/+page.svelte`, 'utf8');

  test('settings/+page.svelte imports ThemePickerCard', () => {
    // A drop of this import makes the whole theming feature unreachable from the UI.
    expect(SETTINGS).toMatch(
      /import\s+ThemePickerCard\s+from\s+['"]\$lib\/components\/settings\/cards\/ThemePickerCard\.svelte['"]/
    );
  });

  test('settings/+page.svelte renders the <ThemePickerCard /> tag', () => {
    // Importing without mounting is just as dead as not importing — pin the actual render.
    expect(SETTINGS).toMatch(/<ThemePickerCard\s*\/>/);
  });
});

/**
 * SWATCH-KEY SAFETY GUARD — the ThemePickerCard swatch loop must key by INDEX, never by the color value.
 * The swatch is a static, never-reordered, presentation-only strip, and a minimalist/monochrome theme can
 * legitimately resolve two swatch tokens to the SAME color (e.g. `background === card`). Svelte throws
 * `each_key_duplicate` at runtime on a keyed `{#each ... (color)}` with a repeated key — crashing the whole
 * picker for that theme. Nothing else catches this: the two current themes happen to have 4 distinct swatch
 * colors, so it is GREEN today and only trips when a future palette (bento/vaporwave/…) ships a dup. This
 * source-scan pins the index-key contract (the C25/C45 one-edit-fix → source-scan idiom on a .svelte loop).
 */
describe('ThemePickerCard swatch loop is keyed crash-safely (index, not color)', () => {
  const PICKER = readFileSync(
    `${process.cwd()}/src/lib/components/settings/cards/ThemePickerCard.svelte`,
    'utf8'
  );

  test('the swatch {#each} keys by index, not by the (possibly-duplicate) color value', () => {
    // Must be `as color, i (i)` — NOT `as color (color)` which throws each_key_duplicate on a dup color.
    expect(PICKER).toMatch(/#each\s+swatchColors\(theme\)\s+as\s+color\s*,\s*i\s*\(i\)/);
    // And must NOT regress to keying on the color value.
    expect(PICKER).not.toMatch(/#each\s+swatchColors\(theme\)\s+as\s+color\s*\(color\)/);
  });
});

/**
 * SWATCH VARIANT-AWARENESS GUARD — each theme's swatch preview must resolve from the variant (light|dark)
 * the user is ACTUALLY in, not a hardcoded one. The whole point of the preview is to not LIE about what
 * applying a theme yields: in dark mode the swatch must show that theme's DARK tokens (e.g. default's
 * primary inverts from near-black oklch(0.21) in light to near-white oklch(0.92) in dark). Certified
 * firsthand eyes-on C348 (shot /settings in light AND dark — the Default swatch's lead square inverts
 * black↔white, blueprint/cyberpunk shift hue+lightness), but NOTHING guards the resolution: a regression
 * to `theme.light` (or `theme.dark`) would make every off-mode preview lie, and it is invisible to a
 * single-mode shot, to byte-freshness (themes.css is fine), and to the swatch-key guard above. This pins
 * the two-link reactive chain in ThemePickerCard.svelte:
 *   1. swatchColors reads `theme[variant]` — the DYNAMIC variant, not a literal `theme.light`/`theme.dark`,
 *   2. `variant` is derived from resolveVariant(mode, …) over the store's active mode (themeStore.current).
 * Source-scan idiom (C25/C190), applied to the picker's preview-correctness contract.
 */
describe('ThemePickerCard swatch previews are variant-aware (C348 preview-correctness guard)', () => {
  const PICKER = readFileSync(
    `${process.cwd()}/src/lib/components/settings/cards/ThemePickerCard.svelte`,
    'utf8'
  );

  test('swatchColors indexes the DYNAMIC variant (theme[variant]), not a hardcoded theme.light/theme.dark', () => {
    // The token map must be read via the computed `variant`, so the preview tracks the active mode.
    expect(PICKER).toMatch(/const\s+tokens\s*=\s*theme\[variant\]/);
    // And must NOT regress to a literal variant that would freeze every preview to one mode.
    expect(PICKER).not.toMatch(/const\s+tokens\s*=\s*theme\.(light|dark)\b/);
  });

  test('the variant is derived from resolveVariant over the active mode (not a constant)', () => {
    // variant = resolveVariant(mode, getSystemTheme()) where mode tracks themeStore.current — so flipping
    // light/dark (or the OS pref under `system`) re-resolves which variant the swatches preview. The OS arm
    // routes through the SHARED getSystemTheme (C349) so the preview resolves `system` exactly as applyTheme.
    expect(PICKER).toMatch(/variant\s*=\s*\$derived\(\s*resolveVariant\(\s*mode\s*,/);
    expect(PICKER).toMatch(/mode\s*=\s*\$derived\(\s*themeStore\.current\s*\)/);
    // The `system`-mode OS resolution must route through the shared store helper, not a local copy.
    expect(PICKER).toMatch(/resolveVariant\(\s*mode\s*,\s*getSystemTheme\(\)\s*\)/);
  });
});
