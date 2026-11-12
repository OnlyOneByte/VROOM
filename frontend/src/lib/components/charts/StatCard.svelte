<script lang="ts" module>
	export type StatCardIconColor =
		| 'primary'
		| 'chart-1'
		| 'chart-2'
		| 'chart-3'
		| 'chart-4'
		| 'chart-5'
		| 'chart-6'
		| 'chart-7'
		| 'chart-8'
		| 'destructive'
		| 'muted';
</script>

<script lang="ts">
	import { Card, CardContent } from '#lib/components/ui/card/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import type { AnyIcon } from './types';

	// Tailwind only generates complete class names it can see; keep each class string literal.
	const ICON_COLOR_MAP: Record<StatCardIconColor, { bg: string; text: string }> = {
		primary: { bg: 'bg-primary/10', text: 'text-primary' },
		'chart-1': { bg: 'bg-chart-1/10', text: 'text-chart-1' },
		'chart-2': { bg: 'bg-chart-2/10', text: 'text-chart-2' },
		'chart-3': { bg: 'bg-chart-3/10', text: 'text-chart-3' },
		'chart-4': { bg: 'bg-chart-4/10', text: 'text-chart-4' },
		'chart-5': { bg: 'bg-chart-5/10', text: 'text-chart-5' },
		'chart-6': { bg: 'bg-chart-6/10', text: 'text-chart-6' },
		'chart-7': { bg: 'bg-chart-7/10', text: 'text-chart-7' },
		'chart-8': { bg: 'bg-chart-8/10', text: 'text-chart-8' },
		destructive: { bg: 'bg-destructive/10', text: 'text-destructive' },
		muted: { bg: 'bg-muted', text: 'text-muted-foreground' }
	};

	const DEFAULT_ICON_CLASSES: { bg: string; text: string } = ICON_COLOR_MAP.primary;

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
	let iconClasses = $derived.by(() => {
		if (Object.hasOwn(ICON_COLOR_MAP, iconColor)) {
			return ICON_COLOR_MAP[iconColor as StatCardIconColor];
		}
		if (import.meta.env.DEV) {
			console.warn(
				`StatCard: unknown iconColor "${iconColor}" — rendering the primary tint. ` +
					`Valid tokens: ${Object.keys(ICON_COLOR_MAP).join(', ')}.`
			);
		}
		return DEFAULT_ICON_CLASSES;
	});
</script>

<Card class={className}>
	<CardContent class="p-4 sm:p-6">
		{#if isLoading}
			<div class="space-y-3">
				<Skeleton class="h-4 w-24" />
				<Skeleton class="h-8 w-32" />
			</div>
		{:else if hasDual}
			<div class="flex items-start justify-between gap-4">
				<div class="flex-1 space-y-1 min-w-0">
					<span class="text-sm font-medium text-muted-foreground">{label}</span>
					<div class="flex items-baseline gap-1 flex-wrap">
						<!-- min-w-0 is required: grid items default to min-width auto and overflow. -->
						<span class="text-2xl font-bold min-w-0 break-words">{value}</span>
						{#if unit}
							<span class="text-xs text-muted-foreground">{unit}</span>
						{/if}
					</div>
				</div>
				<div class="w-px bg-border self-stretch my-1"></div>
				<div class="flex-1 space-y-1 min-w-0">
					<span class="text-sm font-medium text-muted-foreground">{secondaryLabel}</span>
					<div class="flex items-baseline gap-1 flex-wrap">
						<span class="text-2xl font-bold min-w-0 break-words">{secondaryValue}</span>
						{#if secondaryUnit}
							<span class="text-xs text-muted-foreground">{secondaryUnit}</span>
						{/if}
					</div>
				</div>
			</div>
		{:else}
			<div class="flex items-center gap-2">
				{#if icon}
					{@const Icon = icon}
					<div class="p-2 sm:p-3 rounded-xl {iconClasses.bg} shrink-0">
						<Icon class="h-4 w-4 sm:h-5 sm:w-5 {iconClasses.text}" />
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
