/**
 * Theme type model. A theme is a pure value swap on the app.css custom properties declared in both
 * `:root` and `.dark`. `--radius` is `:root`-only, so it is not a themeable key. theme-registry.test.ts
 * checks this list against app.css.
 */

import type { ThemePreference } from '$lib/stores/theme.svelte';

// Orthogonal to the theme id: each theme has a light and a dark variant. Aliases the store's type so both share one vocabulary.
export type ThemeMode = ThemePreference;

/** Unknown ids resolve to the default theme at runtime. */
export type ThemeId = string;

// Keys match the app.css custom properties without the leading `--`. A variant missing one would leak the previous theme's value.
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

/** Runtime list of every {@link ThemeTokenKey}. Consumers must not depend on order. */
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

/** One variant's complete token map. Every key is required; values are CSS color strings such as `oklch(1 0 0)`. */
export type ThemeTokens = Record<ThemeTokenKey, string>;

export interface ThemeVariant {
	light: ThemeTokens;
	dark: ThemeTokens;
}

/** Shipped built-in, or user-authored custom. */
export type ThemeSource = 'builtin' | 'custom';

/** Identity, picker metadata, and the light and dark token maps. `swatch` lists keys, not colors. */
export interface ThemeDefinition extends ThemeVariant {
	id: ThemeId;
	label: string;
	description: string;
	/** Token keys whose colors the picker card previews as a swatch strip. */
	swatch: ThemeTokenKey[];
	source: ThemeSource;
}
