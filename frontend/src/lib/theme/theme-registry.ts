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

/**
 * Factory for a built-in {@link ThemeDefinition} — converges the per-theme boilerplate every palette repeats
 * (`source: 'builtin'` + the default swatch + the fixed field shape). Each new built-in theme is one call
 * with its id/label/description + light/dark maps; `swatch` is OPTIONAL (defaults to {@link DEFAULT_SWATCH},
 * a theme may still pass its own for a characterful preview). This makes "builtin + default swatch" the
 * un-forgettable default so a future palette registration can not omit `source` or mis-shape the object.
 */
function defineBuiltinTheme(
  def: Pick<ThemeDefinition, 'id' | 'label' | 'description' | 'light' | 'dark'> & {
    swatch?: ThemeTokenKey[];
  }
): ThemeDefinition {
  return {
    id: def.id,
    label: def.label,
    description: def.description,
    swatch: def.swatch ?? DEFAULT_SWATCH,
    source: 'builtin',
    light: def.light,
    dark: def.dark,
  };
}

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

const DEFAULT_THEME: ThemeDefinition = defineBuiltinTheme({
  id: 'default',
  label: 'Default',
  description: "VROOM's classic look — clean neutrals with a calm accent.",
  light: DEFAULT_LIGHT,
  dark: DEFAULT_DARK,
});

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

const BLUEPRINT_THEME: ThemeDefinition = defineBuiltinTheme({
  id: 'blueprint',
  label: 'Blueprint',
  description: 'Engineering schematic — cyan on deep navy, a backlit drafting table.',
  light: BLUEPRINT_LIGHT,
  dark: BLUEPRINT_DARK,
});

/**
 * `bento` light palette — a clean bento-light: soft-grey canvas, white card panels, the mock's violet/blue
 * accent family. Distilled from the ryang.dev bento mock (a modular dark dashboard) into VROOM's 32 tokens,
 * AA-tuned (every fg/bg pair clears WCAG AA 4.5 — theme-contrast.test.ts).
 */
const BENTO_LIGHT: ThemeTokens = {
  background: 'oklch(0.97 0.005 265)',
  foreground: 'oklch(0.22 0.02 265)',
  card: 'oklch(1 0 0)',
  'card-foreground': 'oklch(0.22 0.02 265)',
  popover: 'oklch(1 0 0)',
  'popover-foreground': 'oklch(0.22 0.02 265)',
  primary: 'oklch(0.52 0.2 266)',
  'primary-foreground': 'oklch(0.99 0.005 265)',
  secondary: 'oklch(0.94 0.01 265)',
  'secondary-foreground': 'oklch(0.3 0.02 265)',
  muted: 'oklch(0.94 0.01 265)',
  'muted-foreground': 'oklch(0.45 0.02 265)',
  accent: 'oklch(0.9 0.05 300)',
  'accent-foreground': 'oklch(0.3 0.04 300)',
  destructive: 'oklch(0.52 0.22 27)',
  warning: 'oklch(0.55 0.13 75)',
  border: 'oklch(0.88 0.01 265)',
  input: 'oklch(0.88 0.01 265)',
  ring: 'oklch(0.52 0.2 266)',
  'chart-1': 'oklch(0.52 0.2 266)',
  'chart-2': 'oklch(0.55 0.18 300)',
  'chart-3': 'oklch(0.52 0.15 150)',
  'chart-4': 'oklch(0.6 0.15 85)',
  'chart-5': 'oklch(0.55 0.13 200)',
  sidebar: 'oklch(0.95 0.008 265)',
  'sidebar-foreground': 'oklch(0.22 0.02 265)',
  'sidebar-primary': 'oklch(0.52 0.2 266)',
  'sidebar-primary-foreground': 'oklch(0.99 0.005 265)',
  'sidebar-accent': 'oklch(0.9 0.05 300)',
  'sidebar-accent-foreground': 'oklch(0.3 0.04 300)',
  'sidebar-border': 'oklch(0.88 0.01 265)',
  'sidebar-ring': 'oklch(0.52 0.2 266)',
};

/**
 * `bento` dark palette — the mock's native modular-dashboard look: charcoal canvas, lifted card panels, an
 * indigo-blue brand + violet accent. AA-tuned exactly like the light variant (theme-contrast.test.ts).
 */
const BENTO_DARK: ThemeTokens = {
  background: 'oklch(0.17 0.012 265)',
  foreground: 'oklch(0.95 0.01 265)',
  card: 'oklch(0.21 0.014 265)',
  'card-foreground': 'oklch(0.95 0.01 265)',
  popover: 'oklch(0.21 0.014 265)',
  'popover-foreground': 'oklch(0.95 0.01 265)',
  primary: 'oklch(0.55 0.2 266)',
  'primary-foreground': 'oklch(0.98 0.01 265)',
  secondary: 'oklch(0.27 0.015 265)',
  'secondary-foreground': 'oklch(0.95 0.01 265)',
  muted: 'oklch(0.27 0.015 265)',
  'muted-foreground': 'oklch(0.72 0.02 265)',
  accent: 'oklch(0.7 0.13 300)',
  'accent-foreground': 'oklch(0.18 0.02 300)',
  destructive: 'oklch(0.62 0.21 25)',
  warning: 'oklch(0.8 0.13 80)',
  border: 'oklch(0.3 0.016 265)',
  input: 'oklch(0.3 0.016 265)',
  ring: 'oklch(0.55 0.2 266)',
  'chart-1': 'oklch(0.7 0.15 266)',
  'chart-2': 'oklch(0.75 0.13 300)',
  'chart-3': 'oklch(0.78 0.16 150)',
  'chart-4': 'oklch(0.82 0.13 85)',
  'chart-5': 'oklch(0.7 0.13 200)',
  sidebar: 'oklch(0.15 0.012 265)',
  'sidebar-foreground': 'oklch(0.95 0.01 265)',
  'sidebar-primary': 'oklch(0.55 0.2 266)',
  'sidebar-primary-foreground': 'oklch(0.98 0.01 265)',
  'sidebar-accent': 'oklch(0.27 0.015 265)',
  'sidebar-accent-foreground': 'oklch(0.95 0.01 265)',
  'sidebar-border': 'oklch(0.3 0.016 265)',
  'sidebar-ring': 'oklch(0.55 0.2 266)',
};

const BENTO_THEME: ThemeDefinition = defineBuiltinTheme({
  id: 'bento',
  label: 'Bento',
  description: 'Modular dashboard — charcoal panels with violet and blue accents.',
  light: BENTO_LIGHT,
  dark: BENTO_DARK,
});

/**
 * `vaporwave` light palette — a soft-lavender vaporwave-light: pale magenta canvas, the neon-magenta brand,
 * a cyan accent. Distilled from the ryang.dev CRT/vaporwave mock into VROOM's 32 tokens, AA-tuned (every
 * fg/bg pair clears WCAG AA 4.5 — theme-contrast.test.ts). D7 token-only: the palette, not scanline/glow effects.
 */
const VAPORWAVE_LIGHT: ThemeTokens = {
  background: 'oklch(0.97 0.02 320)',
  foreground: 'oklch(0.28 0.12 320)',
  card: 'oklch(0.99 0.01 320)',
  'card-foreground': 'oklch(0.28 0.12 320)',
  popover: 'oklch(0.99 0.01 320)',
  'popover-foreground': 'oklch(0.28 0.12 320)',
  primary: 'oklch(0.55 0.25 350)',
  'primary-foreground': 'oklch(0.99 0.01 320)',
  secondary: 'oklch(0.93 0.04 320)',
  'secondary-foreground': 'oklch(0.35 0.12 320)',
  muted: 'oklch(0.93 0.04 320)',
  'muted-foreground': 'oklch(0.47 0.1 320)',
  accent: 'oklch(0.9 0.08 220)',
  'accent-foreground': 'oklch(0.34 0.12 230)',
  destructive: 'oklch(0.52 0.22 25)',
  warning: 'oklch(0.55 0.13 75)',
  border: 'oklch(0.88 0.04 320)',
  input: 'oklch(0.88 0.04 320)',
  ring: 'oklch(0.55 0.25 350)',
  'chart-1': 'oklch(0.55 0.25 350)',
  'chart-2': 'oklch(0.55 0.15 220)',
  'chart-3': 'oklch(0.6 0.15 90)',
  'chart-4': 'oklch(0.5 0.18 300)',
  'chart-5': 'oklch(0.55 0.2 20)',
  sidebar: 'oklch(0.95 0.03 320)',
  'sidebar-foreground': 'oklch(0.28 0.12 320)',
  'sidebar-primary': 'oklch(0.55 0.25 350)',
  'sidebar-primary-foreground': 'oklch(0.99 0.01 320)',
  'sidebar-accent': 'oklch(0.9 0.08 220)',
  'sidebar-accent-foreground': 'oklch(0.34 0.12 230)',
  'sidebar-border': 'oklch(0.88 0.04 320)',
  'sidebar-ring': 'oklch(0.55 0.25 350)',
};

/**
 * `vaporwave` dark palette — the mock's native look: a deep purple-magenta canvas, neon-magenta brand, cyan
 * accent, gold/pink charts. AA-tuned exactly like the light variant (theme-contrast.test.ts).
 */
const VAPORWAVE_DARK: ThemeTokens = {
  background: 'oklch(0.22 0.11 310)',
  foreground: 'oklch(0.95 0.04 320)',
  card: 'oklch(0.26 0.12 308)',
  'card-foreground': 'oklch(0.95 0.04 320)',
  popover: 'oklch(0.26 0.12 308)',
  'popover-foreground': 'oklch(0.95 0.04 320)',
  primary: 'oklch(0.57 0.26 350)',
  'primary-foreground': 'oklch(0.99 0.01 320)',
  secondary: 'oklch(0.32 0.12 305)',
  'secondary-foreground': 'oklch(0.95 0.04 320)',
  muted: 'oklch(0.3 0.1 305)',
  'muted-foreground': 'oklch(0.8 0.08 320)',
  accent: 'oklch(0.45 0.13 230)',
  'accent-foreground': 'oklch(0.95 0.05 220)',
  destructive: 'oklch(0.62 0.23 18)',
  warning: 'oklch(0.82 0.14 85)',
  border: 'oklch(0.42 0.14 330)',
  input: 'oklch(0.4 0.13 320)',
  ring: 'oklch(0.7 0.2 200)',
  'chart-1': 'oklch(0.68 0.24 350)',
  'chart-2': 'oklch(0.78 0.16 200)',
  'chart-3': 'oklch(0.85 0.15 90)',
  'chart-4': 'oklch(0.7 0.18 300)',
  'chart-5': 'oklch(0.75 0.18 20)',
  sidebar: 'oklch(0.19 0.1 312)',
  'sidebar-foreground': 'oklch(0.95 0.04 320)',
  'sidebar-primary': 'oklch(0.57 0.26 350)',
  'sidebar-primary-foreground': 'oklch(0.99 0.01 320)',
  'sidebar-accent': 'oklch(0.45 0.13 230)',
  'sidebar-accent-foreground': 'oklch(0.95 0.05 220)',
  'sidebar-border': 'oklch(0.42 0.14 330)',
  'sidebar-ring': 'oklch(0.7 0.2 200)',
};

const VAPORWAVE_THEME: ThemeDefinition = defineBuiltinTheme({
  id: 'vaporwave',
  label: 'Vaporwave',
  description: 'Retro-future neon — magenta and cyan on deep purple.',
  light: VAPORWAVE_LIGHT,
  dark: VAPORWAVE_DARK,
});

/**
 * `cyberpunk` light palette — a clean cyberpunk-light: pale blue-grey canvas, the cyan brand, a magenta
 * accent. Distilled from the ryang.dev cyberpunk mock into VROOM's 32 tokens, AA-tuned (theme-contrast.test.ts).
 * D7 token-only: the palette, not the scanline/chromatic-aberration effects.
 */
const CYBERPUNK_LIGHT: ThemeTokens = {
  background: 'oklch(0.97 0.01 220)',
  foreground: 'oklch(0.2 0.03 240)',
  card: 'oklch(0.99 0.005 220)',
  'card-foreground': 'oklch(0.2 0.03 240)',
  popover: 'oklch(0.99 0.005 220)',
  'popover-foreground': 'oklch(0.2 0.03 240)',
  primary: 'oklch(0.5 0.13 205)',
  'primary-foreground': 'oklch(0.99 0.005 220)',
  secondary: 'oklch(0.93 0.02 220)',
  'secondary-foreground': 'oklch(0.28 0.03 240)',
  muted: 'oklch(0.93 0.02 220)',
  'muted-foreground': 'oklch(0.45 0.03 235)',
  accent: 'oklch(0.9 0.07 350)',
  'accent-foreground': 'oklch(0.35 0.12 350)',
  destructive: 'oklch(0.52 0.22 25)',
  warning: 'oklch(0.55 0.13 75)',
  border: 'oklch(0.87 0.02 225)',
  input: 'oklch(0.87 0.02 225)',
  ring: 'oklch(0.5 0.13 205)',
  'chart-1': 'oklch(0.5 0.13 205)',
  'chart-2': 'oklch(0.55 0.22 350)',
  'chart-3': 'oklch(0.6 0.15 80)',
  'chart-4': 'oklch(0.52 0.13 160)',
  'chart-5': 'oklch(0.52 0.16 280)',
  sidebar: 'oklch(0.95 0.015 220)',
  'sidebar-foreground': 'oklch(0.2 0.03 240)',
  'sidebar-primary': 'oklch(0.5 0.13 205)',
  'sidebar-primary-foreground': 'oklch(0.99 0.005 220)',
  'sidebar-accent': 'oklch(0.9 0.07 350)',
  'sidebar-accent-foreground': 'oklch(0.35 0.12 350)',
  'sidebar-border': 'oklch(0.87 0.02 225)',
  'sidebar-ring': 'oklch(0.5 0.13 205)',
};

/**
 * `cyberpunk` dark palette — the mock's native look: near-black slate canvas, neon-cyan brand, magenta
 * accent, amber warning. AA-tuned exactly like the light variant (theme-contrast.test.ts).
 */
const CYBERPUNK_DARK: ThemeTokens = {
  background: 'oklch(0.16 0.02 240)',
  foreground: 'oklch(0.9 0.03 220)',
  card: 'oklch(0.2 0.025 240)',
  'card-foreground': 'oklch(0.9 0.03 220)',
  popover: 'oklch(0.2 0.025 240)',
  'popover-foreground': 'oklch(0.9 0.03 220)',
  primary: 'oklch(0.8 0.16 205)',
  'primary-foreground': 'oklch(0.18 0.03 240)',
  secondary: 'oklch(0.28 0.03 240)',
  'secondary-foreground': 'oklch(0.9 0.03 220)',
  muted: 'oklch(0.26 0.025 240)',
  'muted-foreground': 'oklch(0.72 0.04 225)',
  accent: 'oklch(0.55 0.24 350)',
  'accent-foreground': 'oklch(0.98 0.01 350)',
  destructive: 'oklch(0.62 0.23 18)',
  warning: 'oklch(0.82 0.16 80)',
  border: 'oklch(0.32 0.04 235)',
  input: 'oklch(0.3 0.035 238)',
  ring: 'oklch(0.8 0.16 205)',
  'chart-1': 'oklch(0.8 0.16 205)',
  'chart-2': 'oklch(0.65 0.24 350)',
  'chart-3': 'oklch(0.82 0.16 80)',
  'chart-4': 'oklch(0.7 0.15 160)',
  'chart-5': 'oklch(0.7 0.16 280)',
  sidebar: 'oklch(0.13 0.02 240)',
  'sidebar-foreground': 'oklch(0.9 0.03 220)',
  'sidebar-primary': 'oklch(0.8 0.16 205)',
  'sidebar-primary-foreground': 'oklch(0.18 0.03 240)',
  'sidebar-accent': 'oklch(0.55 0.24 350)',
  'sidebar-accent-foreground': 'oklch(0.98 0.01 350)',
  'sidebar-border': 'oklch(0.32 0.04 235)',
  'sidebar-ring': 'oklch(0.8 0.16 205)',
};

const CYBERPUNK_THEME: ThemeDefinition = defineBuiltinTheme({
  id: 'cyberpunk',
  label: 'Cyberpunk',
  description: 'Night-city terminal — neon cyan and magenta on near-black slate.',
  light: CYBERPUNK_LIGHT,
  dark: CYBERPUNK_DARK,
});

/**
 * `aurora` light palette — a clean aurora-light: near-white canvas, the aurora-blue brand, a teal accent.
 * Distilled from the ryang.dev Glass/Aurora mock into VROOM's 32 tokens, AA-tuned (theme-contrast.test.ts).
 * D7 token-only: the palette, not the gradient-mesh / backdrop-blur effects.
 */
const AURORA_LIGHT: ThemeTokens = {
  background: 'oklch(0.98 0.01 265)',
  foreground: 'oklch(0.24 0.05 265)',
  card: 'oklch(1 0 0)',
  'card-foreground': 'oklch(0.24 0.05 265)',
  popover: 'oklch(1 0 0)',
  'popover-foreground': 'oklch(0.24 0.05 265)',
  primary: 'oklch(0.52 0.18 265)',
  'primary-foreground': 'oklch(0.99 0.005 265)',
  secondary: 'oklch(0.94 0.02 265)',
  'secondary-foreground': 'oklch(0.3 0.05 265)',
  muted: 'oklch(0.94 0.02 265)',
  'muted-foreground': 'oklch(0.46 0.04 265)',
  accent: 'oklch(0.88 0.08 180)',
  'accent-foreground': 'oklch(0.32 0.08 200)',
  destructive: 'oklch(0.52 0.22 25)',
  warning: 'oklch(0.55 0.13 75)',
  border: 'oklch(0.88 0.02 265)',
  input: 'oklch(0.88 0.02 265)',
  ring: 'oklch(0.52 0.18 265)',
  'chart-1': 'oklch(0.52 0.18 265)',
  'chart-2': 'oklch(0.52 0.18 300)',
  'chart-3': 'oklch(0.55 0.13 180)',
  'chart-4': 'oklch(0.5 0.16 230)',
  'chart-5': 'oklch(0.55 0.17 330)',
  sidebar: 'oklch(0.96 0.015 265)',
  'sidebar-foreground': 'oklch(0.24 0.05 265)',
  'sidebar-primary': 'oklch(0.52 0.18 265)',
  'sidebar-primary-foreground': 'oklch(0.99 0.005 265)',
  'sidebar-accent': 'oklch(0.88 0.08 180)',
  'sidebar-accent-foreground': 'oklch(0.32 0.08 200)',
  'sidebar-border': 'oklch(0.88 0.02 265)',
  'sidebar-ring': 'oklch(0.52 0.18 265)',
};

/**
 * `aurora` dark palette — the mock's native look: a deep-navy canvas with an aurora-blue brand + teal
 * accent (the gradient-mesh hues as solid tokens). AA-tuned exactly like the light variant (theme-contrast.test.ts).
 */
const AURORA_DARK: ThemeTokens = {
  background: 'oklch(0.18 0.04 265)',
  foreground: 'oklch(0.92 0.02 265)',
  card: 'oklch(0.23 0.045 265)',
  'card-foreground': 'oklch(0.92 0.02 265)',
  popover: 'oklch(0.23 0.045 265)',
  'popover-foreground': 'oklch(0.92 0.02 265)',
  primary: 'oklch(0.66 0.16 265)',
  'primary-foreground': 'oklch(0.16 0.04 265)',
  secondary: 'oklch(0.3 0.04 265)',
  'secondary-foreground': 'oklch(0.92 0.02 265)',
  muted: 'oklch(0.28 0.035 265)',
  'muted-foreground': 'oklch(0.74 0.03 265)',
  accent: 'oklch(0.7 0.13 180)',
  'accent-foreground': 'oklch(0.18 0.04 200)',
  destructive: 'oklch(0.62 0.22 20)',
  warning: 'oklch(0.82 0.14 85)',
  border: 'oklch(0.34 0.04 265)',
  input: 'oklch(0.32 0.04 265)',
  ring: 'oklch(0.66 0.16 265)',
  'chart-1': 'oklch(0.7 0.15 265)',
  'chart-2': 'oklch(0.72 0.16 300)',
  'chart-3': 'oklch(0.78 0.13 180)',
  'chart-4': 'oklch(0.7 0.15 230)',
  'chart-5': 'oklch(0.75 0.15 330)',
  sidebar: 'oklch(0.15 0.04 265)',
  'sidebar-foreground': 'oklch(0.92 0.02 265)',
  'sidebar-primary': 'oklch(0.66 0.16 265)',
  'sidebar-primary-foreground': 'oklch(0.16 0.04 265)',
  'sidebar-accent': 'oklch(0.7 0.13 180)',
  'sidebar-accent-foreground': 'oklch(0.18 0.04 200)',
  'sidebar-border': 'oklch(0.34 0.04 265)',
  'sidebar-ring': 'oklch(0.66 0.16 265)',
};

const AURORA_THEME: ThemeDefinition = defineBuiltinTheme({
  id: 'aurora',
  label: 'Aurora',
  description: 'Premium glass — aurora blue and teal on deep navy.',
  light: AURORA_LIGHT,
  dark: AURORA_DARK,
});

/**
 * `solarpunk` light palette — the mock's native warm look: cream/sand canvas, moss-green brand, clay accent,
 * warm-brown text. The first WARM/organic theme (the v1 set is all cool/neon). Distilled from the ryang.dev
 * solarpunk mock into VROOM's 32 tokens, AA-tuned (theme-contrast.test.ts). D7 token-only.
 */
const SOLARPUNK_LIGHT: ThemeTokens = {
  background: 'oklch(0.95 0.02 95)',
  foreground: 'oklch(0.3 0.03 75)',
  card: 'oklch(0.99 0.01 95)',
  'card-foreground': 'oklch(0.3 0.03 75)',
  popover: 'oklch(0.99 0.01 95)',
  'popover-foreground': 'oklch(0.3 0.03 75)',
  primary: 'oklch(0.52 0.12 135)',
  'primary-foreground': 'oklch(0.99 0.01 95)',
  secondary: 'oklch(0.9 0.03 95)',
  'secondary-foreground': 'oklch(0.34 0.04 75)',
  muted: 'oklch(0.9 0.03 95)',
  'muted-foreground': 'oklch(0.46 0.04 80)',
  accent: 'oklch(0.88 0.06 70)',
  'accent-foreground': 'oklch(0.38 0.08 60)',
  destructive: 'oklch(0.52 0.2 28)',
  warning: 'oklch(0.6 0.13 70)',
  border: 'oklch(0.86 0.03 90)',
  input: 'oklch(0.86 0.03 90)',
  ring: 'oklch(0.52 0.12 135)',
  'chart-1': 'oklch(0.52 0.12 135)',
  'chart-2': 'oklch(0.55 0.11 70)',
  'chart-3': 'oklch(0.5 0.1 170)',
  'chart-4': 'oklch(0.55 0.14 40)',
  'chart-5': 'oklch(0.5 0.13 330)',
  sidebar: 'oklch(0.93 0.025 95)',
  'sidebar-foreground': 'oklch(0.3 0.03 75)',
  'sidebar-primary': 'oklch(0.52 0.12 135)',
  'sidebar-primary-foreground': 'oklch(0.99 0.01 95)',
  'sidebar-accent': 'oklch(0.88 0.06 70)',
  'sidebar-accent-foreground': 'oklch(0.38 0.08 60)',
  'sidebar-border': 'oklch(0.86 0.03 90)',
  'sidebar-ring': 'oklch(0.52 0.12 135)',
};

/**
 * `solarpunk` dark palette — a night-garden: deep warm-brown/olive canvas, moss-green brand, muted clay
 * accent. AA-tuned exactly like the light variant (theme-contrast.test.ts).
 */
const SOLARPUNK_DARK: ThemeTokens = {
  background: 'oklch(0.22 0.02 75)',
  foreground: 'oklch(0.92 0.03 90)',
  card: 'oklch(0.26 0.025 75)',
  'card-foreground': 'oklch(0.92 0.03 90)',
  popover: 'oklch(0.26 0.025 75)',
  'popover-foreground': 'oklch(0.92 0.03 90)',
  primary: 'oklch(0.68 0.14 135)',
  'primary-foreground': 'oklch(0.2 0.03 90)',
  secondary: 'oklch(0.32 0.03 75)',
  'secondary-foreground': 'oklch(0.92 0.03 90)',
  muted: 'oklch(0.3 0.025 75)',
  'muted-foreground': 'oklch(0.74 0.04 85)',
  accent: 'oklch(0.5 0.1 60)',
  'accent-foreground': 'oklch(0.97 0.02 90)',
  destructive: 'oklch(0.62 0.21 28)',
  warning: 'oklch(0.78 0.14 75)',
  border: 'oklch(0.36 0.03 75)',
  input: 'oklch(0.34 0.03 75)',
  ring: 'oklch(0.68 0.14 135)',
  'chart-1': 'oklch(0.7 0.14 135)',
  'chart-2': 'oklch(0.72 0.13 70)',
  'chart-3': 'oklch(0.7 0.11 170)',
  'chart-4': 'oklch(0.72 0.15 40)',
  'chart-5': 'oklch(0.68 0.13 330)',
  sidebar: 'oklch(0.19 0.02 75)',
  'sidebar-foreground': 'oklch(0.92 0.03 90)',
  'sidebar-primary': 'oklch(0.68 0.14 135)',
  'sidebar-primary-foreground': 'oklch(0.2 0.03 90)',
  'sidebar-accent': 'oklch(0.5 0.1 60)',
  'sidebar-accent-foreground': 'oklch(0.97 0.02 90)',
  'sidebar-border': 'oklch(0.36 0.03 75)',
  'sidebar-ring': 'oklch(0.68 0.14 135)',
};

const SOLARPUNK_THEME: ThemeDefinition = defineBuiltinTheme({
  id: 'solarpunk',
  label: 'Solarpunk',
  description: 'Warm and organic — moss green and clay on cream.',
  light: SOLARPUNK_LIGHT,
  dark: SOLARPUNK_DARK,
});

/**
 * `editorial` light palette — the mock's native magazine look: cream paper, near-black ink, a crimson
 * accent, warm-grey muted. A warm-NEUTRAL palette whose signature is the crimson. Distilled from the
 * ryang.dev editorial mock into VROOM's 32 tokens, AA-tuned (theme-contrast.test.ts). D7 token-only.
 */
const EDITORIAL_LIGHT: ThemeTokens = {
  background: 'oklch(0.97 0.012 85)',
  foreground: 'oklch(0.22 0.005 60)',
  card: 'oklch(0.99 0.008 85)',
  'card-foreground': 'oklch(0.22 0.005 60)',
  popover: 'oklch(0.99 0.008 85)',
  'popover-foreground': 'oklch(0.22 0.005 60)',
  primary: 'oklch(0.5 0.17 27)',
  'primary-foreground': 'oklch(0.99 0.008 85)',
  secondary: 'oklch(0.92 0.014 85)',
  'secondary-foreground': 'oklch(0.3 0.01 60)',
  muted: 'oklch(0.92 0.014 85)',
  'muted-foreground': 'oklch(0.45 0.015 70)',
  accent: 'oklch(0.9 0.03 40)',
  'accent-foreground': 'oklch(0.4 0.13 30)',
  destructive: 'oklch(0.5 0.2 27)',
  warning: 'oklch(0.58 0.13 70)',
  border: 'oklch(0.87 0.014 80)',
  input: 'oklch(0.87 0.014 80)',
  ring: 'oklch(0.5 0.17 27)',
  'chart-1': 'oklch(0.5 0.17 27)',
  'chart-2': 'oklch(0.5 0.08 60)',
  'chart-3': 'oklch(0.5 0.1 140)',
  'chart-4': 'oklch(0.55 0.12 250)',
  'chart-5': 'oklch(0.5 0.13 310)',
  sidebar: 'oklch(0.95 0.014 85)',
  'sidebar-foreground': 'oklch(0.22 0.005 60)',
  'sidebar-primary': 'oklch(0.5 0.17 27)',
  'sidebar-primary-foreground': 'oklch(0.99 0.008 85)',
  'sidebar-accent': 'oklch(0.9 0.03 40)',
  'sidebar-accent-foreground': 'oklch(0.4 0.13 30)',
  'sidebar-border': 'oklch(0.87 0.014 80)',
  'sidebar-ring': 'oklch(0.5 0.17 27)',
};

/**
 * `editorial` dark palette — a warm-charcoal newsprint: dark warm-grey canvas, cream ink, the crimson brand.
 * AA-tuned exactly like the light variant (theme-contrast.test.ts).
 */
const EDITORIAL_DARK: ThemeTokens = {
  background: 'oklch(0.21 0.008 60)',
  foreground: 'oklch(0.93 0.012 85)',
  card: 'oklch(0.25 0.009 60)',
  'card-foreground': 'oklch(0.93 0.012 85)',
  popover: 'oklch(0.25 0.009 60)',
  'popover-foreground': 'oklch(0.93 0.012 85)',
  primary: 'oklch(0.62 0.18 27)',
  'primary-foreground': 'oklch(0.18 0.01 60)',
  secondary: 'oklch(0.31 0.01 60)',
  'secondary-foreground': 'oklch(0.93 0.012 85)',
  muted: 'oklch(0.29 0.009 60)',
  'muted-foreground': 'oklch(0.74 0.014 80)',
  accent: 'oklch(0.5 0.12 30)',
  'accent-foreground': 'oklch(0.96 0.02 85)',
  destructive: 'oklch(0.62 0.21 27)',
  warning: 'oklch(0.78 0.14 75)',
  border: 'oklch(0.35 0.01 60)',
  input: 'oklch(0.33 0.01 60)',
  ring: 'oklch(0.62 0.18 27)',
  'chart-1': 'oklch(0.68 0.18 27)',
  'chart-2': 'oklch(0.72 0.08 60)',
  'chart-3': 'oklch(0.7 0.12 140)',
  'chart-4': 'oklch(0.7 0.13 250)',
  'chart-5': 'oklch(0.68 0.14 310)',
  sidebar: 'oklch(0.18 0.008 60)',
  'sidebar-foreground': 'oklch(0.93 0.012 85)',
  'sidebar-primary': 'oklch(0.62 0.18 27)',
  'sidebar-primary-foreground': 'oklch(0.18 0.01 60)',
  'sidebar-accent': 'oklch(0.5 0.12 30)',
  'sidebar-accent-foreground': 'oklch(0.96 0.02 85)',
  'sidebar-border': 'oklch(0.35 0.01 60)',
  'sidebar-ring': 'oklch(0.62 0.18 27)',
};

const EDITORIAL_THEME: ThemeDefinition = defineBuiltinTheme({
  id: 'editorial',
  label: 'Editorial',
  description: 'Magazine print — crimson and ink on cream paper.',
  light: EDITORIAL_LIGHT,
  dark: EDITORIAL_DARK,
});

/**
 * `tui` light palette — a paper-terminal: cream canvas, dark-amber brand, teal-green accent. Distilled from
 * the ryang.dev terminal/TUI mock into VROOM's 32 tokens, AA-tuned (theme-contrast.test.ts). D7 token-only
 * (no box-drawing/monospace layout — the palette only).
 */
const TUI_LIGHT: ThemeTokens = {
  background: 'oklch(0.96 0.01 95)',
  foreground: 'oklch(0.24 0.02 90)',
  card: 'oklch(0.99 0.006 95)',
  'card-foreground': 'oklch(0.24 0.02 90)',
  popover: 'oklch(0.99 0.006 95)',
  'popover-foreground': 'oklch(0.24 0.02 90)',
  primary: 'oklch(0.52 0.1 85)',
  'primary-foreground': 'oklch(0.99 0.006 95)',
  secondary: 'oklch(0.92 0.02 95)',
  'secondary-foreground': 'oklch(0.3 0.02 90)',
  muted: 'oklch(0.92 0.02 95)',
  'muted-foreground': 'oklch(0.45 0.02 90)',
  accent: 'oklch(0.88 0.06 165)',
  'accent-foreground': 'oklch(0.34 0.08 165)',
  destructive: 'oklch(0.52 0.22 25)',
  warning: 'oklch(0.55 0.13 75)',
  border: 'oklch(0.86 0.015 95)',
  input: 'oklch(0.86 0.015 95)',
  ring: 'oklch(0.52 0.1 85)',
  'chart-1': 'oklch(0.52 0.1 85)',
  'chart-2': 'oklch(0.5 0.12 165)',
  'chart-3': 'oklch(0.5 0.13 240)',
  'chart-4': 'oklch(0.52 0.16 350)',
  'chart-5': 'oklch(0.5 0.14 140)',
  sidebar: 'oklch(0.94 0.012 95)',
  'sidebar-foreground': 'oklch(0.24 0.02 90)',
  'sidebar-primary': 'oklch(0.52 0.1 85)',
  'sidebar-primary-foreground': 'oklch(0.99 0.006 95)',
  'sidebar-accent': 'oklch(0.88 0.06 165)',
  'sidebar-accent-foreground': 'oklch(0.34 0.08 165)',
  'sidebar-border': 'oklch(0.86 0.015 95)',
  'sidebar-ring': 'oklch(0.52 0.1 85)',
};

/**
 * `tui` dark palette — the mock's native terminal look: near-black canvas, amber brand, teal-green accent,
 * blue/pink/green charts (the heatmap hues). AA-tuned exactly like the light variant (theme-contrast.test.ts).
 */
const TUI_DARK: ThemeTokens = {
  background: 'oklch(0.16 0.004 90)',
  foreground: 'oklch(0.9 0.02 95)',
  card: 'oklch(0.2 0.005 90)',
  'card-foreground': 'oklch(0.9 0.02 95)',
  popover: 'oklch(0.2 0.005 90)',
  'popover-foreground': 'oklch(0.9 0.02 95)',
  primary: 'oklch(0.8 0.12 85)',
  'primary-foreground': 'oklch(0.18 0.01 90)',
  secondary: 'oklch(0.27 0.006 90)',
  'secondary-foreground': 'oklch(0.9 0.02 95)',
  muted: 'oklch(0.25 0.005 90)',
  'muted-foreground': 'oklch(0.7 0.02 95)',
  accent: 'oklch(0.5 0.1 165)',
  'accent-foreground': 'oklch(0.97 0.02 160)',
  destructive: 'oklch(0.62 0.21 25)',
  warning: 'oklch(0.8 0.13 80)',
  border: 'oklch(0.32 0.006 90)',
  input: 'oklch(0.3 0.006 90)',
  ring: 'oklch(0.8 0.12 85)',
  'chart-1': 'oklch(0.8 0.12 85)',
  'chart-2': 'oklch(0.72 0.13 165)',
  'chart-3': 'oklch(0.68 0.13 240)',
  'chart-4': 'oklch(0.68 0.15 350)',
  'chart-5': 'oklch(0.75 0.15 140)',
  sidebar: 'oklch(0.13 0.004 90)',
  'sidebar-foreground': 'oklch(0.9 0.02 95)',
  'sidebar-primary': 'oklch(0.8 0.12 85)',
  'sidebar-primary-foreground': 'oklch(0.18 0.01 90)',
  'sidebar-accent': 'oklch(0.5 0.1 165)',
  'sidebar-accent-foreground': 'oklch(0.97 0.02 160)',
  'sidebar-border': 'oklch(0.32 0.006 90)',
  'sidebar-ring': 'oklch(0.8 0.12 85)',
};

const TUI_THEME: ThemeDefinition = defineBuiltinTheme({
  id: 'tui',
  label: 'Terminal',
  description: 'Text-mode terminal — amber and green on near-black.',
  light: TUI_LIGHT,
  dark: TUI_DARK,
});

/**
 * Every built-in theme by id. `default` is the always-present identity theme (R8 fallback target). The
 * Angelo-approved v1 set (default + 5: blueprint/bento/vaporwave/cyberpunk/aurora) is COMPLETE; solarpunk/
 * editorial/tui are fill-ins from the ryang.dev mocks. Each theme is a single defineBuiltinTheme call — zero
 * structural change; further fill-ins (y2k/neobrutalist/claymorphism/brutalist/zine) drop in the same way.
 */
export const THEME_REGISTRY: Record<string, ThemeDefinition> = {
  default: DEFAULT_THEME,
  blueprint: BLUEPRINT_THEME,
  bento: BENTO_THEME,
  vaporwave: VAPORWAVE_THEME,
  cyberpunk: CYBERPUNK_THEME,
  aurora: AURORA_THEME,
  solarpunk: SOLARPUNK_THEME,
  editorial: EDITORIAL_THEME,
  tui: TUI_THEME,
};

/** The id every unknown/absent selection resolves to (R8). */
export const DEFAULT_THEME_ID = 'default';
