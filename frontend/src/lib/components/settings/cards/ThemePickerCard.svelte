<script lang="ts">
	// Picks the theme ID; the light/dark variant is chosen separately in ThemeCard.
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

	// The registry always contains `default`, so the grid is never empty.
	const themes: ThemeDefinition[] = Object.values(THEME_REGISTRY);

	let activeId = $derived(themeStore.themeId);
	let mode = $derived(themeStore.current);

	// Same system-preference resolver as applyTheme, so previews match what gets rendered.
	let variant = $derived(resolveVariant(mode, getSystemTheme()));

	// Swatches come from each theme's own definition, not the live CSS variables (active theme only).
	function swatchColors(theme: ThemeDefinition): string[] {
		const tokens = theme[variant];
		return theme.swatch.map(key => tokens[key]);
	}
</script>

<Card>
	<CardHeader>
		<CardTitle>Theme</CardTitle>
		<CardDescription
			>Pick a color theme. Your light/dark choice above still applies.</CardDescription
		>
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
						<!-- Keyed by index: swatch colours can repeat, and duplicate keys crash the picker. -->
						{#each swatchColors(theme) as color, i (i)}
							<span class="h-6 w-6 rounded-md border border-border/50" style={`background:${color}`}
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
