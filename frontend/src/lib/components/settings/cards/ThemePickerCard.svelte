<script lang="ts">
	// Theming engine T10 — the theme-ID picker. A responsive grid of theme cards (one per registry theme),
	// each previewing its OWN palette via a swatch strip (resolved from that theme's definition, NOT the
	// active theme), with a selected-state ring. Click → themeStore.setTheme(id) → instant live re-skin.
	// Composes the kit (Card) per DesignSystem.md — no bespoke controls. Orthogonal to the light/dark mode
	// selector in ThemeCard (D3): this picks the theme ID; that picks the variant.
	import { Check } from '@lucide/svelte';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { getSystemTheme, themeStore } from '$lib/stores/theme.svelte';
	import { THEME_REGISTRY } from '$lib/theme/theme-registry';
	import { resolveVariant } from '$lib/theme/resolve-theme';
	import type { ThemeDefinition } from '$lib/theme/theme-types';
	import { cn } from '$lib/utils';

	// The static built-in registry (order: default first, then the rest). Empty-safe: the registry always
	// contains `default`, so the grid is never empty (four-states: only the "data" state is reachable).
	const themes: ThemeDefinition[] = Object.values(THEME_REGISTRY);

	let activeId = $derived(themeStore.themeId);
	let mode = $derived(themeStore.current);

	// The concrete variant (light|dark) the previews should show, tracking the active mode. Under `system`
	// the OS preference is resolved by the SAME getSystemTheme the store's applyTheme uses (single source of
	// truth — so the preview can never disagree with what applying the theme will actually render, C349).
	let variant = $derived(resolveVariant(mode, getSystemTheme()));

	// Each theme's own swatch colors, resolved from ITS definition (not the live CSS vars, which only
	// reflect the active theme). Values are the raw oklch strings from the registry → safe inline styles.
	function swatchColors(theme: ThemeDefinition): string[] {
		const tokens = theme[variant];
		return theme.swatch.map((key) => tokens[key]);
	}
</script>

<Card>
	<CardHeader>
		<CardTitle>Theme</CardTitle>
		<CardDescription>Pick a color theme. Your light/dark choice above still applies.</CardDescription>
	</CardHeader>
	<CardContent>
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
			{#each themes as theme (theme.id)}
				{@const selected = activeId === theme.id}
				<button
					type="button"
					aria-pressed={selected}
					aria-label={`Use the ${theme.label} theme`}
					class={cn(
						'relative flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors',
						selected
							? 'border-primary ring-2 ring-primary'
							: 'border-border hover:bg-accent hover:text-accent-foreground'
					)}
					onclick={() => themeStore.setTheme(theme.id)}
				>
					{#if selected}
						<span
							class="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground"
						>
							<Check class="h-3 w-3" />
						</span>
					{/if}
					<div class="flex gap-1" aria-hidden="true">
						<!-- Key by INDEX, not color value: the swatch is a static, never-reordered, presentation-only
						     strip, and a minimalist/monochrome theme can legitimately resolve two swatch tokens to the
						     SAME color (e.g. background === card) — keying on (color) would throw Svelte's
						     each_key_duplicate at runtime and crash the whole picker for that theme. -->
						{#each swatchColors(theme) as color, i (i)}
							<span
								class="h-6 w-6 rounded-md border border-border/50"
								style={`background:${color}`}
							></span>
						{/each}
					</div>
					<div>
						<div class="text-sm font-medium">{theme.label}</div>
						<div class="text-xs text-muted-foreground">{theme.description}</div>
					</div>
				</button>
			{/each}
		</div>
	</CardContent>
</Card>
