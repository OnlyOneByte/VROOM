<script lang="ts">
	import { Card, CardContent } from '#lib/components/ui/card/index.ts';
	import { getSystemTheme, themeStore } from '#lib/stores/theme.svelte.ts';
	import { THEME_REGISTRY } from '#lib/theme/theme-registry.ts';
	import { resolveVariant } from '#lib/theme/resolve-theme.ts';
	import type { ThemeDefinition } from '#lib/theme/theme-types.ts';
	import { cn } from '#lib/utils.ts';

	const themes: ThemeDefinition[] = Object.values(THEME_REGISTRY);
	const uid = $props.id();

	let activeId = $derived(themeStore.themeId);
	let mode = $derived(themeStore.current);
	let variant = $derived(resolveVariant(mode, getSystemTheme()));

	function swatchColors(theme: ThemeDefinition): string[] {
		const tokens = theme[variant];
		return theme.swatch.map(key => tokens[key]);
	}
</script>

<Card variant="section" role="group" aria-labelledby="{uid}-accent">
	<CardContent class="space-y-3">
		<div>
			<p id="{uid}-accent" class="font-medium">Accent</p>
			<p class="text-sm text-muted-foreground">Used for highlights and the add button.</p>
		</div>
		<div class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
			{#each themes as theme (theme.id)}
				{@const selected = activeId === theme.id}
				<button
					type="button"
					aria-pressed={selected}
					class={cn(
						'flex min-h-10 flex-col gap-2 rounded-(--r-md) border bg-surface p-2.5 text-left outline-none transition-colors hover:bg-sunk focus-visible:ring-[3px] focus-visible:ring-ring/50',
						selected && 'border-foreground shadow-[inset_0_0_0_1px_var(--foreground)]'
					)}
					onclick={() => themeStore.setTheme(theme.id)}
				>
					<span class="flex h-8 overflow-hidden rounded-(--r-sm)" aria-hidden="true">
						<!-- Index-keyed: swatch colours can repeat, and duplicate keys throw. -->
						{#each swatchColors(theme) as color, i (i)}
							<span class="flex-1" style={`background:${color}`}></span>
						{/each}
					</span>
					<span class="text-sm font-semibold">{theme.label}</span>
				</button>
			{/each}
		</div>
	</CardContent>
</Card>
