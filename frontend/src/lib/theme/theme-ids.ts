import { DEFAULT_THEME_ID } from './theme-chrome';

export const ACCENT_THEME_IDS = [
	DEFAULT_THEME_ID,
	'vermilion',
	'electric',
	'racing-green'
] as const;

const LEGACY_THEME_IDS: Record<string, (typeof ACCENT_THEME_IDS)[number]> = {
	bento: DEFAULT_THEME_ID,
	blueprint: DEFAULT_THEME_ID,
	tui: DEFAULT_THEME_ID,
	editorial: 'vermilion',
	neobrutalist: 'vermilion',
	vaporwave: 'electric',
	cyberpunk: 'electric',
	y2k: 'electric',
	solarpunk: 'racing-green',
	aurora: 'racing-green'
};

export function canonicalThemeId(themeId: string | null | undefined): string {
	if (!themeId) return DEFAULT_THEME_ID;
	if ((ACCENT_THEME_IDS as readonly string[]).includes(themeId)) return themeId;
	return Object.hasOwn(LEGACY_THEME_IDS, themeId)
		? (LEGACY_THEME_IDS[themeId] ?? DEFAULT_THEME_ID)
		: DEFAULT_THEME_ID;
}
