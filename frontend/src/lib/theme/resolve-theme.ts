/** Picks the token map for a theme id and mode. Pure and total: malformed input falls back to default. */

import { DEFAULT_THEME_ID, THEME_REGISTRY } from './theme-registry';
import type { ThemeDefinition, ThemeId, ThemeMode, ThemeTokens } from './theme-types';

export type ResolvedVariant = 'light' | 'dark';

// Unknown, empty or garbage ids fall back to default.
export function resolveThemeDefinition(themeId: ThemeId | null | undefined): ThemeDefinition {
	if (themeId && Object.hasOwn(THEME_REGISTRY, themeId)) {
		const def = THEME_REGISTRY[themeId];
		if (def) return def;
	}
	// The registry always contains default; the cast keeps this function total.
	return THEME_REGISTRY[DEFAULT_THEME_ID] as ThemeDefinition;
}

// `system` defers to the OS preference; an absent preference resolves to light.
export function resolveVariant(
	mode: ThemeMode | null | undefined,
	systemPref: ResolvedVariant | null | undefined
): ResolvedVariant {
	if (mode === 'light' || mode === 'dark') return mode;
	return systemPref === 'dark' ? 'dark' : 'light';
}

// Anything other than light or dark follows systemPref.
export function resolveTheme(
	themeId: ThemeId | null | undefined,
	mode: ThemeMode | null | undefined,
	systemPref: ResolvedVariant | null | undefined
): ThemeTokens {
	const definition = resolveThemeDefinition(themeId);
	const variant = resolveVariant(mode, systemPref);
	return definition[variant];
}
