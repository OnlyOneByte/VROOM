import type { SvelteComponent, Component } from 'svelte';

/**
 * Union type that accepts both Svelte 5 function-based Components and
 * Svelte 4 class-based components (SvelteComponentTyped). Needed because
 * lucide-svelte v0.x still exports Svelte 4 class constructors.
 *
 * The `any[]` for constructor args is intentional: Svelte 4 class components
 * expect `ComponentConstructorOptions` which is contravariant — `unknown[]`
 * is too wide and `never[]` rejects all args. This is the one place where
 * `any` is acceptable as a compatibility shim.
 */

export type AnyIcon =
	| Component<Record<string, unknown>>
	| (new (..._args: any[]) => SvelteComponent);
