<script lang="ts">
	import { Check } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.ts';
	import { getSystemTheme, themeStore } from '#lib/stores/theme.svelte.ts';
	import { THEME_REGISTRY } from '#lib/theme/theme-registry.ts';
	import { resolveVariant } from '#lib/theme/resolve-theme.ts';
	import type { ThemeDefinition } from '#lib/theme/theme-types.ts';
	import { cn } from '#lib/utils.ts';

	const themes: ThemeDefinition[] = Object.values(THEME_REGISTRY);
	const uid = $props.id();
	const gridId = `${uid}-themes`;

	let showAll = $state(false);

	let activeId = $derived(themeStore.themeId);
	let mode = $derived(themeStore.current);

	let variant = $derived(resolveVariant(mode, getSystemTheme()));
	let activeTheme = $derived(themes.find(theme => theme.id === activeId) ?? themes[0]);

	function swatchColors(theme: ThemeDefinition): string[] {
		const tokens = theme[variant];
		return theme.swatch.map(key => tokens[key]);
	}
</script>

<Card>
	<CardHeader>
		<CardTitle>Theme</CardTitle>
		<CardDescription>
			Pick a color theme. It applies right away, in the mode you chose above.
		</CardDescription>
	</CardHeader>
	<CardContent>
		{#if activeTheme && !showAll}
			<div
				class="mb-3 flex items-center gap-3 rounded-lg border border-primary p-3 lg:hidden"
				data-testid="current-theme"
			>
				{@render swatches(activeTheme)}
				<div class="min-w-0">
					<div class="text-sm font-medium">{activeTheme.label}</div>
					<div class="text-xs text-muted-foreground">{activeTheme.description}</div>
				</div>
			</div>
		{/if}
		<Button
			variant="outline"
			class="h-10 w-full lg:hidden"
			aria-expanded={showAll}
			aria-controls={gridId}
			onclick={() => (showAll = !showAll)}
		>
			{showAll ? 'Show fewer themes' : `Show all ${themes.length} themes`}
		</Button>
		<div
			id={gridId}
			class={cn('grid-cols-2 gap-3 sm:grid-cols-3 lg:grid', showAll ? 'mt-3 grid' : 'hidden')}
		>
			{#each themes as theme (theme.id)}
				{@const selected = activeId === theme.id}
				<button
					type="button"
					aria-pressed={selected}
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
					{@render swatches(theme)}
					<div>
						<div class="text-sm font-medium">{theme.label}</div>
						<div class="text-xs text-muted-foreground">{theme.description}</div>
					</div>
				</button>
			{/each}
		</div>
	</CardContent>
</Card>

{#snippet swatches(theme: ThemeDefinition)}
	<div class="flex shrink-0 gap-1" aria-hidden="true">
		<!-- Index-keyed: swatch colours can repeat, and duplicate keys throw. -->
		{#each swatchColors(theme) as color, i (i)}
			<span class="h-6 w-6 rounded-md border border-border/50" style={`background:${color}`}></span>
		{/each}
	</div>
{/snippet}
