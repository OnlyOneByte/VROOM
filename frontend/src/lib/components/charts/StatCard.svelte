<script lang="ts">
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import type { SvelteComponent, Component } from 'svelte';

	// Lucide-svelte v0.x exports Svelte 4 class components (SvelteComponentTyped)
	// which aren't assignable to Svelte 5's function-based Component type.
	// Use a union to accept both legacy class constructors and modern components.

	type AnyIcon = Component<Record<string, unknown>> | (new (..._args: any[]) => SvelteComponent);

	interface Props {
		label: string;
		value: string | number;
		unit?: string;
		icon?: AnyIcon;
		iconColor?: string;
		secondaryLabel?: string;
		secondaryValue?: string | number;
		secondaryUnit?: string;
		subtitle?: string;
		isLoading?: boolean;
		class?: string;
	}

	let {
		label,
		value,
		unit,
		icon,
		iconColor = 'primary',
		secondaryLabel,
		secondaryValue,
		secondaryUnit,
		subtitle,
		isLoading = false,
		class: className
	}: Props = $props();

	let hasDual = $derived(secondaryLabel !== undefined && secondaryValue !== undefined);
</script>

<Card class={className}>
	<CardContent class="p-4 sm:p-6">
		{#if isLoading}
			<div class="space-y-3">
				<Skeleton class="h-4 w-24" />
				<Skeleton class="h-8 w-32" />
			</div>
		{:else if hasDual}
			<!-- Dual metric layout -->
			<div class="flex items-start justify-between gap-4">
				<div class="flex-1 space-y-1 min-w-0">
					<span class="text-sm font-medium text-muted-foreground">{label}</span>
					<div class="flex items-baseline gap-1 flex-wrap">
						<span class="text-2xl font-bold">{value}</span>
						{#if unit}
							<span class="text-xs text-muted-foreground">{unit}</span>
						{/if}
					</div>
				</div>
				<div class="w-px bg-border self-stretch my-1"></div>
				<div class="flex-1 space-y-1 min-w-0">
					<span class="text-sm font-medium text-muted-foreground">{secondaryLabel}</span>
					<div class="flex items-baseline gap-1 flex-wrap">
						<span class="text-2xl font-bold">{secondaryValue}</span>
						{#if secondaryUnit}
							<span class="text-xs text-muted-foreground">{secondaryUnit}</span>
						{/if}
					</div>
				</div>
			</div>
		{:else}
			<!-- Standard layout with optional icon -->
			<div class="flex items-center gap-2">
				{#if icon}
					{@const Icon = icon}
					<div class="p-2 sm:p-3 rounded-xl bg-{iconColor}/10 shrink-0">
						<Icon class="h-4 w-4 sm:h-5 sm:w-5 text-{iconColor}" />
					</div>
				{/if}
				<p class="text-xs sm:text-sm font-medium text-muted-foreground">{label}</p>
			</div>
			<p class="text-xl sm:text-2xl font-bold mt-2">{value}</p>
			{#if unit}
				<span class="text-xs text-muted-foreground">{unit}</span>
			{/if}
			{#if subtitle}
				<p class="text-xs text-muted-foreground mt-1">{subtitle}</p>
			{/if}
		{/if}
	</CardContent>
</Card>
