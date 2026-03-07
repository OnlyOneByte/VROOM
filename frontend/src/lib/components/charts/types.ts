import type { Component } from 'svelte';

/**
 * Icon type for chart components.
 * Uses Svelte 5 Component type — all icons come from @lucide/svelte (pure Svelte 5).
 */
export type AnyIcon = Component<Record<string, unknown>>;
