/**
 * Theming engine — the theme resolver (spec T6, Phase 2). Pure + TOTAL: given a theme id, the chosen
 * light/dark mode, and the OS preference (for `mode==='system'`), return the exact token map to apply.
 * Never throws — every malformed input resolves to the `default` theme's appropriate variant (R8), so a
 * corrupted/stale persisted theme id (or a removed built-in) degrades gracefully to today's look rather
 * than blanking the UI.
 *
 * This is the single decision point the store (T8) calls before applying tokens to the DOM (T7's
 * `data-theme`/themes.css does the actual painting; this picks WHICH variant's values).
 */

import { DEFAULT_THEME_ID, THEME_REGISTRY } from './theme-registry';
import type { ThemeDefinition, ThemeId, ThemeMode, ThemeTokens } from './theme-types';

/** The concrete variant a mode resolves to. `system` is resolved against the OS pref by the caller-supplied value. */
export type ResolvedVariant = 'light' | 'dark';

/**
 * Look up a theme definition by id, falling back to `default` for an unknown/empty/garbage id (R8). Total:
 * always returns a definition (the registry always contains `default`). Exported so the store/picker can
 * resolve a definition's metadata (label/swatch) with the same fallback semantics.
 */
export function resolveThemeDefinition(themeId: ThemeId | null | undefined): ThemeDefinition {
  if (themeId && Object.hasOwn(THEME_REGISTRY, themeId)) {
    const def = THEME_REGISTRY[themeId];
    if (def) return def;
  }
  // The registry is constructed with `default` always present; this non-null is a belt-and-braces
  // fallback so the function stays total even if the registry were ever mis-shaped.
  return THEME_REGISTRY[DEFAULT_THEME_ID] as ThemeDefinition;
}

/**
 * Resolve which concrete variant (`light`/`dark`) a mode selects. `system` defers to the OS preference;
 * an absent/garbage systemPref defaults to `light` (the safe, lightest-surface default).
 */
export function resolveVariant(
  mode: ThemeMode | null | undefined,
  systemPref: ResolvedVariant | null | undefined
): ResolvedVariant {
  if (mode === 'light' || mode === 'dark') return mode;
  // mode === 'system' (or anything unrecognized) → follow the OS preference.
  return systemPref === 'dark' ? 'dark' : 'light';
}

/**
 * The full resolver: (themeId, mode, systemPref) → the token map to apply. Pure, total, never throws.
 * Unknown id → default; `system` mode → the systemPref variant; anything malformed → default's light.
 */
export function resolveTheme(
  themeId: ThemeId | null | undefined,
  mode: ThemeMode | null | undefined,
  systemPref: ResolvedVariant | null | undefined
): ThemeTokens {
  const definition = resolveThemeDefinition(themeId);
  const variant = resolveVariant(mode, systemPref);
  return definition[variant];
}
