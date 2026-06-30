/**
 * Theming engine — the D4 HARD GATE: every built-in theme must clear WCAG AA (4.5:1 normal text) on every
 * foreground/background token pair, in BOTH variants. D4 ("a11y is a hard gate, not best-effort") cannot be
 * verified by an eyes-on screenshot — contrast is a computed property — so this is the canonical, durable,
 * merge-surviving guard (NORTH_STAR #5). It re-derives luminance from the oklch token values themselves, so
 * a future theme (or an edit to an existing one) that ships a low-contrast pair turns this RED before merge.
 *
 * Pure math — oklch → linear sRGB (the same matrix the browser uses) → WCAG relative luminance → ratio. No
 * DOM, no render. Validated against the shipped `default` palette (known-AA) by the same assertions below.
 */

import { describe, expect, test } from 'vitest';
import { DEFAULT_THEME_ID, THEME_REGISTRY } from '../theme-registry';
import type { ThemeTokenKey, ThemeTokens } from '../theme-types';

/** Parse an `oklch(L C H[/ a%])` string. Alpha is ignored — contrast is computed on the opaque color. */
function parseOklch(s: string): { L: number; C: number; H: number } {
  const m = s.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+%?)?\s*\)/);
  if (!m) throw new Error(`not an oklch() value: ${s}`);
  return { L: Number(m[1]), C: Number(m[2]), H: Number(m[3]) };
}

/** oklch → linear-sRGB (Björn Ottosson's OKLab matrices). Returns unclamped linear r/g/b. */
function oklchToLinearRGB(s: string): { r: number; g: number; b: number } {
  const { L, C, H } = parseOklch(s);
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const bb = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = L - 0.0894841775 * a - 1.291485548 * bb;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const sCube = s_ ** 3;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * sCube,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * sCube,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * sCube,
  };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** WCAG relative luminance from a linear-sRGB color (already linear → no extra de-gamma). */
function luminance(oklch: string): number {
  const { r, g, b } = oklchToLinearRGB(oklch);
  return 0.2126 * clamp01(r) + 0.7152 * clamp01(g) + 0.0722 * clamp01(b);
}

/** WCAG contrast ratio between two oklch colors. */
function contrast(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

const AA_NORMAL = 4.5;

/**
 * Foreground/background pairs that carry body text or UI labels. Each must clear AA. `muted-foreground` is
 * checked against BOTH `background` and `muted` (it renders on both). These are the pairs a reader actually
 * reads — chart/border/ring/destructive/warning tokens are decorative or status accents (AA-large at most),
 * so they are not asserted as AA-normal here (a future enhancement could add AA-large 3:1 for those).
 */
const TEXT_PAIRS: ReadonlyArray<readonly [ThemeTokenKey, ThemeTokenKey]> = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'muted'],
  ['sidebar-foreground', 'sidebar'],
  ['sidebar-primary-foreground', 'sidebar-primary'],
  ['sidebar-accent-foreground', 'sidebar-accent'],
];

describe('every built-in theme clears WCAG AA on text pairs (D4 hard gate)', () => {
  // Sanity: the converter is correct. Pure white vs pure black is exactly 21:1.
  test('the contrast converter is calibrated (white/black ≈ 21:1)', () => {
    expect(contrast('oklch(1 0 0)', 'oklch(0 0 0)')).toBeGreaterThan(20.9);
  });

  describe.each(Object.values(THEME_REGISTRY))('theme "$id"', (theme) => {
    describe.each(['light', 'dark'] as const)('%s variant', (variant) => {
      const tokens = theme[variant] as ThemeTokens;
      test.each(TEXT_PAIRS)('%s on %s ≥ AA 4.5', (fg, bg) => {
        const ratio = contrast(tokens[fg], tokens[bg]);
        expect(
          ratio,
          `${theme.id}.${variant}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1 (need ≥ ${AA_NORMAL})`
        ).toBeGreaterThanOrEqual(AA_NORMAL);
      });
    });
  });

  // Non-vacuity floor: a deliberately bad pair must FAIL, proving the assertion can fail.
  test('a known low-contrast pair is correctly rejected (non-vacuous)', () => {
    expect(contrast('oklch(0.7 0 0)', 'oklch(0.75 0 0)')).toBeLessThan(AA_NORMAL);
  });
});

/**
 * CHART-SERIES GRAPHICAL CONTRAST (WCAG 1.4.11, 3:1) — every NON-default theme's chart-1..5 must clear 3:1
 * against the surface they render on (`card` — analytics charts live in ChartCard). The TEXT_PAIRS gate
 * above deliberately excludes chart tokens (they carry no text), but a chart SERIES is a graphical object a
 * user must distinguish from its background, so the relevant bar is the 3:1 non-text threshold, not 4.5.
 *
 * WHY this guard exists (C343 + C346/C347): the C343 scout established firsthand that all 8 then-shipped
 * non-default themes clear 3:1 chart-vs-card, and ONLY `default` falls below on three tokens — but `default`
 * is the VERBATIM app.css palette locked by the C185 identity contract (changing it breaks that guard + is
 * an Angelo-gated product call on the shipped look), so it is EXCLUDED here. Nothing enforced the property
 * for NEW themes: the C346 y2k fill-in (and the remaining neobrutalist/claymorphism/brutalist/zine) could
 * ship a pale chart token below 3:1 and NO guard would catch it (contrast checks only text pairs; metadata/
 * distinctness/byte-freshness check structure, not chart legibility). This codifies the C343 invariant so a
 * future low-contrast chart token trips RED before merge — the durable artifact from the C347 bug-dry scout.
 */
const CHART_KEYS: readonly ThemeTokenKey[] = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  // #112: the palette extends to 8 so a ≥6-vehicle fleet gets distinct series colors. The new tokens are
  // held to the SAME 3:1-vs-card graphical bar as 1-5 (every non-default theme defines all 8).
  'chart-6',
  'chart-7',
  'chart-8',
];
const AA_GRAPHICAL = 3.0;
const nonDefaultThemes = Object.values(THEME_REGISTRY).filter((t) => t.id !== DEFAULT_THEME_ID);

describe('every NON-default theme clears WCAG 3:1 on chart series vs card (C347 graphical gate)', () => {
  describe.each(nonDefaultThemes)('theme "$id"', (theme) => {
    describe.each(['light', 'dark'] as const)('%s variant', (variant) => {
      const tokens = theme[variant] as ThemeTokens;
      test.each(CHART_KEYS)('%s on card ≥ 3:1', (chart) => {
        const ratio = contrast(tokens[chart], tokens.card);
        expect(
          ratio,
          `${theme.id}.${variant}: ${chart} on card = ${ratio.toFixed(2)}:1 (need ≥ ${AA_GRAPHICAL} — a chart series must be distinguishable from its surface)`
        ).toBeGreaterThanOrEqual(AA_GRAPHICAL);
      });
    });
  });
});
