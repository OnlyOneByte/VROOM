import { DEFAULT_THEME_ID, THEME_REGISTRY } from './theme-registry';
import type { ThemeDefinition, ThemeId, ThemeMode, ThemeTokens } from './theme-types';

export type ResolvedVariant = 'light' | 'dark';

export function resolveThemeDefinition(themeId: ThemeId | null | undefined): ThemeDefinition {
	if (themeId && Object.hasOwn(THEME_REGISTRY, themeId)) {
		const def = THEME_REGISTRY[themeId];
		if (def) return def;
	}
	return THEME_REGISTRY[DEFAULT_THEME_ID] as ThemeDefinition;
}

export function resolveVariant(
	mode: ThemeMode | null | undefined,
	systemPref: ResolvedVariant | null | undefined
): ResolvedVariant {
	if (mode === 'light' || mode === 'dark') return mode;
	return systemPref === 'dark' ? 'dark' : 'light';
}

export function resolveTheme(
	themeId: ThemeId | null | undefined,
	mode: ThemeMode | null | undefined,
	systemPref: ResolvedVariant | null | undefined
): ThemeTokens {
	const definition = resolveThemeDefinition(themeId);
	const variant = resolveVariant(mode, systemPref);
	return definition[variant];
}
