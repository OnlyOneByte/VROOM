/**
 * Theming engine — theme registry (spec T5, Phase 2). The runtime source of truth for every built-in
 * theme's token VALUES. The resolver (T6) looks themes up here; the themes.css emitter (T7) generates one
 * `:root[data-theme=...]` block per registry entry from these maps.
 *
 * `default` is the EXISTING look, its light+dark token maps transcribed VERBATIM from `src/app.css`
 * (`:root` + `.dark`). A guard (theme-registry.test.ts) parses the live app.css and asserts the `default`
 * definition equals it value-for-value — so `default` is provably a zero-visual-change identity theme (R1)
 * and any future app.css edit that isn't mirrored here trips the guard (baseline-drift detection).
 *
 * The first NON-default theme (`instrument`, per D1/D5) is DESIGN-GATED: its palette must be distilled
 * from the design-language mock + AA-tuned (A3/R10), which is a product/design decision, not a loop
 * self-authorization. It lands in a follow-up once the palette is provided. The registry + the integrity
 * guard are built to accept it with zero structural change (add one ThemeDefinition).
 */

import type { ThemeDefinition, ThemeTokenKey, ThemeTokens } from './theme-types';

/**
 * The default swatch strip the picker card previews when a theme does not specify its own. These four
 * tokens read well as a representative 4-color preview for any palette (brand, accent, surface, ink). A
 * theme MAY override `swatch` for a more characterful preview; most reuse this. Order is presentation-only.
 */
const DEFAULT_SWATCH: ThemeTokenKey[] = ['primary', 'accent', 'background', 'foreground'];

/** `default` light palette — VERBATIM from app.css `:root` (C185). Do not edit by hand; mirror app.css. */
const DEFAULT_LIGHT: ThemeTokens = {
  background: 'oklch(1 0 0)',
  foreground: 'oklch(0.141 0.005 285.823)',
  card: 'oklch(1 0 0)',
  'card-foreground': 'oklch(0.141 0.005 285.823)',
  popover: 'oklch(1 0 0)',
  'popover-foreground': 'oklch(0.141 0.005 285.823)',
  primary: 'oklch(0.21 0.006 285.885)',
  'primary-foreground': 'oklch(0.985 0 0)',
  secondary: 'oklch(0.967 0.001 286.375)',
  'secondary-foreground': 'oklch(0.21 0.006 285.885)',
  muted: 'oklch(0.967 0.001 286.375)',
  'muted-foreground': 'oklch(0.486 0.016 285.938)',
  accent: 'oklch(0.967 0.001 286.375)',
  'accent-foreground': 'oklch(0.21 0.006 285.885)',
  destructive: 'oklch(0.505 0.22 27.325)',
  warning: 'oklch(0.52 0.12 75)',
  border: 'oklch(0.92 0.004 286.32)',
  input: 'oklch(0.92 0.004 286.32)',
  ring: 'oklch(0.705 0.015 286.067)',
  'chart-1': 'oklch(0.646 0.222 41.116)',
  'chart-2': 'oklch(0.6 0.118 184.704)',
  'chart-3': 'oklch(0.398 0.07 227.392)',
  'chart-4': 'oklch(0.828 0.189 84.429)',
  'chart-5': 'oklch(0.769 0.188 70.08)',
  sidebar: 'oklch(0.985 0 0)',
  'sidebar-foreground': 'oklch(0.141 0.005 285.823)',
  'sidebar-primary': 'oklch(0.21 0.006 285.885)',
  'sidebar-primary-foreground': 'oklch(0.985 0 0)',
  'sidebar-accent': 'oklch(0.967 0.001 286.375)',
  'sidebar-accent-foreground': 'oklch(0.21 0.006 285.885)',
  'sidebar-border': 'oklch(0.92 0.004 286.32)',
  'sidebar-ring': 'oklch(0.705 0.015 286.067)',
};

/** `default` dark palette — VERBATIM from app.css `.dark` (C185). Do not edit by hand; mirror app.css. */
const DEFAULT_DARK: ThemeTokens = {
  background: 'oklch(0.141 0.005 285.823)',
  foreground: 'oklch(0.985 0 0)',
  card: 'oklch(0.21 0.006 285.885)',
  'card-foreground': 'oklch(0.985 0 0)',
  popover: 'oklch(0.21 0.006 285.885)',
  'popover-foreground': 'oklch(0.985 0 0)',
  primary: 'oklch(0.92 0.004 286.32)',
  'primary-foreground': 'oklch(0.21 0.006 285.885)',
  secondary: 'oklch(0.274 0.006 286.033)',
  'secondary-foreground': 'oklch(0.985 0 0)',
  muted: 'oklch(0.274 0.006 286.033)',
  'muted-foreground': 'oklch(0.705 0.015 286.067)',
  accent: 'oklch(0.274 0.006 286.033)',
  'accent-foreground': 'oklch(0.985 0 0)',
  destructive: 'oklch(0.704 0.191 22.216)',
  warning: 'oklch(0.8 0.13 80)',
  border: 'oklch(1 0 0 / 10%)',
  input: 'oklch(1 0 0 / 15%)',
  ring: 'oklch(0.552 0.016 285.938)',
  'chart-1': 'oklch(0.488 0.243 264.376)',
  'chart-2': 'oklch(0.696 0.17 162.48)',
  'chart-3': 'oklch(0.769 0.188 70.08)',
  'chart-4': 'oklch(0.627 0.265 303.9)',
  'chart-5': 'oklch(0.645 0.246 16.439)',
  sidebar: 'oklch(0.21 0.006 285.885)',
  'sidebar-foreground': 'oklch(0.985 0 0)',
  'sidebar-primary': 'oklch(0.488 0.243 264.376)',
  'sidebar-primary-foreground': 'oklch(0.985 0 0)',
  'sidebar-accent': 'oklch(0.274 0.006 286.033)',
  'sidebar-accent-foreground': 'oklch(0.985 0 0)',
  'sidebar-border': 'oklch(1 0 0 / 10%)',
  'sidebar-ring': 'oklch(0.552 0.016 285.938)',
};

const DEFAULT_THEME: ThemeDefinition = {
  id: 'default',
  label: 'Default',
  description: "VROOM's classic look — clean neutrals with a calm accent.",
  swatch: DEFAULT_SWATCH,
  source: 'builtin',
  light: DEFAULT_LIGHT,
  dark: DEFAULT_DARK,
};

/**
 * `blueprint` light palette — an engineering "whiteprint": navy ink on pale drafting-paper blue. Distilled
 * from the ryang.dev blueprint mock (cyan-on-navy schematic) into VROOM's 32 tokens, then AA-tuned: every
 * foreground/background pair clears WCAG AA 4.5 (verified by theme-contrast.test.ts, the D4 hard gate).
 */
const BLUEPRINT_LIGHT: ThemeTokens = {
  background: 'oklch(0.98 0.01 230)',
  foreground: 'oklch(0.25 0.05 245)',
  card: 'oklch(0.99 0.005 230)',
  'card-foreground': 'oklch(0.25 0.05 245)',
  popover: 'oklch(0.99 0.005 230)',
  'popover-foreground': 'oklch(0.25 0.05 245)',
  primary: 'oklch(0.5 0.13 245)',
  'primary-foreground': 'oklch(0.99 0.005 230)',
  secondary: 'oklch(0.93 0.025 235)',
  'secondary-foreground': 'oklch(0.3 0.05 245)',
  muted: 'oklch(0.94 0.02 235)',
  'muted-foreground': 'oklch(0.44 0.06 245)',
  accent: 'oklch(0.9 0.04 235)',
  'accent-foreground': 'oklch(0.3 0.05 245)',
  destructive: 'oklch(0.52 0.22 27)',
  warning: 'oklch(0.55 0.13 75)',
  border: 'oklch(0.85 0.03 235)',
  input: 'oklch(0.85 0.03 235)',
  ring: 'oklch(0.5 0.13 245)',
  'chart-1': 'oklch(0.5 0.15 245)',
  'chart-2': 'oklch(0.55 0.12 200)',
  'chart-3': 'oklch(0.52 0.15 160)',
  'chart-4': 'oklch(0.6 0.15 70)',
  'chart-5': 'oklch(0.52 0.18 330)',
  sidebar: 'oklch(0.96 0.015 235)',
  'sidebar-foreground': 'oklch(0.25 0.05 245)',
  'sidebar-primary': 'oklch(0.5 0.13 245)',
  'sidebar-primary-foreground': 'oklch(0.99 0.005 230)',
  'sidebar-accent': 'oklch(0.9 0.04 235)',
  'sidebar-accent-foreground': 'oklch(0.3 0.05 245)',
  'sidebar-border': 'oklch(0.85 0.03 235)',
  'sidebar-ring': 'oklch(0.5 0.13 245)',
};

/**
 * `blueprint` dark palette — the mock's native look: cyan on deep navy, a backlit drafting table. AA-tuned
 * exactly like the light variant (theme-contrast.test.ts).
 */
const BLUEPRINT_DARK: ThemeTokens = {
  background: 'oklch(0.22 0.04 245)',
  foreground: 'oklch(0.93 0.03 230)',
  card: 'oklch(0.26 0.045 245)',
  'card-foreground': 'oklch(0.93 0.03 230)',
  popover: 'oklch(0.24 0.045 245)',
  'popover-foreground': 'oklch(0.93 0.03 230)',
  primary: 'oklch(0.7 0.12 235)',
  'primary-foreground': 'oklch(0.2 0.04 245)',
  secondary: 'oklch(0.32 0.04 245)',
  'secondary-foreground': 'oklch(0.93 0.03 230)',
  muted: 'oklch(0.3 0.035 245)',
  'muted-foreground': 'oklch(0.76 0.05 233)',
  accent: 'oklch(0.34 0.05 240)',
  'accent-foreground': 'oklch(0.93 0.03 230)',
  destructive: 'oklch(0.62 0.21 25)',
  warning: 'oklch(0.8 0.13 80)',
  border: 'oklch(0.4 0.05 240)',
  input: 'oklch(0.4 0.05 240)',
  ring: 'oklch(0.7 0.12 235)',
  'chart-1': 'oklch(0.7 0.13 230)',
  'chart-2': 'oklch(0.7 0.12 190)',
  'chart-3': 'oklch(0.78 0.16 150)',
  'chart-4': 'oklch(0.82 0.13 80)',
  'chart-5': 'oklch(0.72 0.15 350)',
  sidebar: 'oklch(0.2 0.04 245)',
  'sidebar-foreground': 'oklch(0.93 0.03 230)',
  'sidebar-primary': 'oklch(0.7 0.12 235)',
  'sidebar-primary-foreground': 'oklch(0.2 0.04 245)',
  'sidebar-accent': 'oklch(0.3 0.045 245)',
  'sidebar-accent-foreground': 'oklch(0.93 0.03 230)',
  'sidebar-border': 'oklch(0.38 0.05 240)',
  'sidebar-ring': 'oklch(0.7 0.12 235)',
};

const BLUEPRINT_THEME: ThemeDefinition = {
  id: 'blueprint',
  label: 'Blueprint',
  description: 'Engineering schematic — cyan on deep navy, a backlit drafting table.',
  swatch: DEFAULT_SWATCH,
  source: 'builtin',
  light: BLUEPRINT_LIGHT,
  dark: BLUEPRINT_DARK,
};

/**
 * Every built-in theme by id. `default` is the always-present identity theme (R8 fallback target).
 * Additional Angelo-approved themes (bento, vaporwave, cyberpunk, aurora, …) are appended here as their
 * AA-tuned palettes land — each is a single additive ThemeDefinition; the registry/emitter/guards need
 * zero structural change to absorb one.
 */
export const THEME_REGISTRY: Record<string, ThemeDefinition> = {
  default: DEFAULT_THEME,
  blueprint: BLUEPRINT_THEME,
};

/** The id every unknown/absent selection resolves to (R8). */
export const DEFAULT_THEME_ID = 'default';
