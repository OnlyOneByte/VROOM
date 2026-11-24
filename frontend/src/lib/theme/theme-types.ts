import type { ThemePreference } from '#lib/stores/theme.svelte.ts';

export type ThemeMode = ThemePreference;

export type ThemeId = string;

// Keys must match the app.css custom properties; a missing key leaks the previous theme value.
export type ThemeTokenKey =
	| 'accent'
	| 'accent-foreground'
	| 'accent-ink'
	| 'background'
	| 'bar'
	| 'bar-fg'
	| 'bar-on'
	| 'border'
	| 'border-strong'
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
	| 'destructive-foreground'
	| 'due-tint'
	| 'foreground'
	| 'info'
	| 'info-tint'
	| 'input'
	| 'muted'
	| 'muted-foreground'
	| 'needle'
	| 'ok-tint'
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
	| 'soon-tint'
	| 'success'
	| 'sunk'
	| 'surface'
	| 'warning';

export const THEME_TOKEN_KEYS = [
	'accent',
	'accent-foreground',
	'accent-ink',
	'background',
	'bar',
	'bar-fg',
	'bar-on',
	'border',
	'border-strong',
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
	'destructive-foreground',
	'due-tint',
	'foreground',
	'info',
	'info-tint',
	'input',
	'muted',
	'muted-foreground',
	'needle',
	'ok-tint',
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
	'soon-tint',
	'success',
	'sunk',
	'surface',
	'warning'
] as const satisfies readonly ThemeTokenKey[];

export type ThemeTokens = Record<ThemeTokenKey, string>;

interface ThemeVariant {
	light: ThemeTokens;
	dark: ThemeTokens;
}

type ThemeSource = 'builtin' | 'custom';

export interface ThemeDefinition extends ThemeVariant {
	id: ThemeId;
	label: string;
	description: string;
	swatch: ThemeTokenKey[];
	source: ThemeSource;
}
