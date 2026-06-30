/**
 * Theming engine — type model (spec T4, Phase 2). TYPES ONLY: no token values, no registry, no runtime
 * behavior. Values arrive in T5 (theme-registry.ts); the resolver in T6.
 *
 * Load-bearing contract (R1, inviolable): a theme is a pure VALUE swap on the EXISTING `app.css` custom
 * properties — zero component/markup changes. So `ThemeTokenKey` is EXACTLY the set of per-variant color
 * custom properties `src/app.css` declares in BOTH `:root` (light) and `.dark` (dark). Verified firsthand
 * (C181): those two blocks declare an identical 32-key set; `--radius` is `:root`-only (a variant-invariant
 * layout token) and is therefore NOT a themeable per-variant key. A guard in T5 asserts this list still
 * equals the live app.css set so a future token add/remove can't silently desync the engine.
 */

import type { ThemePreference } from '$lib/stores/theme.svelte';

/**
 * The light/dark/system axis. This is ORTHOGONAL to the theme id (D3): a theme defines BOTH a light and a
 * dark variant, and the mode picks which one renders. Aliased to the existing store's `ThemePreference`
 * (the single source of truth — the store owns the matchMedia/system-listener behavior) so the engine and
 * the store can never disagree on the mode vocabulary.
 */
export type ThemeMode = ThemePreference;

/** A built-in theme id. v1 set (D1/D5): `default` (today's look) + `instrument`, with `garage` to follow. */
export type ThemeId = string;

/**
 * Every per-variant themeable token, by its `app.css` custom-property name WITHOUT the leading `--`.
 * EXACTLY the keys declared in both `:root` and `.dark` (C181 census). A `ThemeVariant` must specify all
 * of them — a missing key would leave that token at the previously-applied theme's value (a visual leak),
 * which the T5 registry-integrity test forbids.
 */
export type ThemeTokenKey =
  | 'accent'
  | 'accent-foreground'
  | 'background'
  | 'border'
  | 'card'
  | 'card-foreground'
  | 'chart-1'
  | 'chart-2'
  | 'chart-3'
  | 'chart-4'
  | 'chart-5'
  | 'chart-6'
  | 'chart-7'
  | 'chart-8'
  | 'destructive'
  | 'foreground'
  | 'input'
  | 'muted'
  | 'muted-foreground'
  | 'popover'
  | 'popover-foreground'
  | 'primary'
  | 'primary-foreground'
  | 'ring'
  | 'secondary'
  | 'secondary-foreground'
  | 'sidebar'
  | 'sidebar-accent'
  | 'sidebar-accent-foreground'
  | 'sidebar-border'
  | 'sidebar-foreground'
  | 'sidebar-primary'
  | 'sidebar-primary-foreground'
  | 'sidebar-ring'
  | 'warning';

/**
 * The runtime-checkable list of every {@link ThemeTokenKey}, frozen. The T5 registry-integrity test pins
 * this against the live app.css `:root`/`.dark` declarations (so a token add/remove forces a matching
 * registry + type update) AND asserts every {@link ThemeDefinition} variant declares all of them. Order is
 * the app.css declaration order's sorted census; consumers must not depend on order.
 */
export const THEME_TOKEN_KEYS = [
  'accent',
  'accent-foreground',
  'background',
  'border',
  'card',
  'card-foreground',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
  'chart-7',
  'chart-8',
  'destructive',
  'foreground',
  'input',
  'muted',
  'muted-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'ring',
  'secondary',
  'secondary-foreground',
  'sidebar',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-ring',
  'warning',
] as const satisfies readonly ThemeTokenKey[];

/**
 * A complete token map for ONE variant (one light or one dark palette). EVERY {@link ThemeTokenKey} is
 * required — a partial map is not a valid variant (see THEME_TOKEN_KEYS rationale). Values are CSS color
 * strings as they appear in app.css (oklch(...) per A2), e.g. `'oklch(1 0 0)'`.
 */
export type ThemeTokens = Record<ThemeTokenKey, string>;

/** A theme's two variants. The {@link ThemeMode} (resolved against the OS pref for `system`) picks one. */
export interface ThemeVariant {
  light: ThemeTokens;
  dark: ThemeTokens;
}

/** Where a theme came from — a shipped built-in or (future, D6) a user-authored custom theme. */
export type ThemeSource = 'builtin' | 'custom';

/**
 * A full theme definition: identity + presentation metadata + the light/dark token maps. The picker (T10)
 * reads `label`/`description`/`swatch`; the resolver (T6) reads `light`/`dark`. `swatch` is a small list of
 * representative token keys the card renders as a color strip (not a value — the resolved variant supplies
 * the actual colors).
 */
export interface ThemeDefinition extends ThemeVariant {
  id: ThemeId;
  label: string;
  description: string;
  /** Token keys whose colors the picker card previews as a swatch strip. */
  swatch: ThemeTokenKey[];
  source: ThemeSource;
}
