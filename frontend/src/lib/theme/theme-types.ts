import type { ThemePreference } from '$lib/stores/theme.svelte';

export type ThemeMode = ThemePreference;

export type ThemeId = string;

// Keys must match the app.css custom properties; a missing key leaks the previous theme value.
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
	| 'destructive-foreground'
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
	'destructive-foreground',
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
	'warning'
] as const satisfies readonly ThemeTokenKey[];

export type ThemeTokens = Record<ThemeTokenKey, string>;

export interface ThemeVariant {
	light: ThemeTokens;
	dark: ThemeTokens;
}

export type ThemeSource = 'builtin' | 'custom';

export interface ThemeDefinition extends ThemeVariant {
	id: ThemeId;
	label: string;
	description: string;
	swatch: ThemeTokenKey[];
	source: ThemeSource;
}
