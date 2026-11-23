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

	/** A whole-percent change against an earlier period, and which direction is the good one. */
	export interface StatCardChange {
		percent: number;
		goodWhen: 'up' | 'down';
		label: string;
	}
</script>

<script lang="ts">
	import { Minus, TrendingDown, TrendingUp } from '@lucide/svelte';
	import { Card, CardContent } from '#lib/components/ui/card/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import { cn } from '#lib/utils.js';
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
		change?: StatCardChange | null;
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
		change,
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

<Card class={cn('py-0', className)}>
	<CardContent class="p-4 sm:p-6">
		{#if isLoading && !hasDual}
			<div class="flex items-center gap-2">
				{#if icon}
					<div class="shrink-0" data-stat-icon>
						<Skeleton class="size-8 sm:size-11 rounded-xl" />
					</div>
				{/if}
				<Skeleton class="h-4 sm:h-5 w-24" />
			</div>
			<Skeleton class="h-7 sm:h-8 w-32 mt-2" data-stat-value />
			{#if unit}
				<Skeleton class="inline-block h-3 w-16 align-middle" data-stat-unit-bar />
			{/if}
			{#if subtitle}
				<div class="relative text-xs mt-1" aria-hidden="true">
					<span class="invisible">{subtitle}</span>
					<Skeleton class="absolute inset-0" />
				</div>
			{/if}
		{:else if hasDual}
			<div class="@container">
				<div class="flex flex-col @sm:flex-row @sm:items-start @sm:justify-between gap-3 @sm:gap-4">
					<div class="flex-1 space-y-1 min-w-0">
						{#if isLoading}
							<Skeleton class="h-5 w-24" />
							<div>
								<Skeleton class="h-7 @sm:h-8 w-20" />
								{#if unit}
									<Skeleton class="mt-1 h-4 w-16 sm:@max-sm:hidden" />
								{/if}
							</div>
						{:else}
							<span class="block text-sm font-medium text-muted-foreground break-words">
								{label}
							</span>
							<div class="sm:@max-sm:flex sm:@max-sm:items-baseline sm:@max-sm:gap-1">
								<span class="block text-xl @sm:text-2xl font-bold tabular-nums whitespace-nowrap">
									{value}
								</span>
								{#if unit}
									<span
										class="mt-1 block text-xs text-muted-foreground sm:@max-sm:mt-0 sm:@max-sm:whitespace-nowrap"
									>
										{unit}
									</span>
								{/if}
							</div>
						{/if}
					</div>
					<div class="h-px w-full @sm:h-auto @sm:w-px bg-border @sm:self-stretch @sm:my-1"></div>
					<div class="flex-1 space-y-1 min-w-0">
						{#if isLoading}
							<Skeleton class="h-5 w-24" />
							<div>
								<Skeleton class="h-7 @sm:h-8 w-20" />
								{#if secondaryUnit}
									<Skeleton class="mt-1 h-4 w-16 sm:@max-sm:hidden" />
								{/if}
							</div>
						{:else}
							<span class="block text-sm font-medium text-muted-foreground break-words">
								{secondaryLabel}
							</span>
							<div class="sm:@max-sm:flex sm:@max-sm:items-baseline sm:@max-sm:gap-1">
								<span class="block text-xl @sm:text-2xl font-bold tabular-nums whitespace-nowrap">
									{secondaryValue}
								</span>
								{#if secondaryUnit}
									<span
										class="mt-1 block text-xs text-muted-foreground sm:@max-sm:mt-0 sm:@max-sm:whitespace-nowrap"
									>
										{secondaryUnit}
									</span>
								{/if}
							</div>
						{/if}
					</div>
				</div>
			</div>
		{:else}
			<div class="flex items-center gap-2">
				{#if icon}
					{@const Icon = icon}
					<div class="p-2 sm:p-3 rounded-xl {iconClasses.bg} shrink-0" data-stat-icon>
						<Icon class="h-4 w-4 sm:h-5 sm:w-5 {iconClasses.text}" />
					</div>
				{/if}
				<p class="text-xs sm:text-sm font-medium text-muted-foreground">{label}</p>
			</div>
			<p class="text-xl sm:text-2xl font-bold tabular-nums mt-2" data-stat-value>{value}</p>
			{#if unit}
				<span class="text-xs text-muted-foreground">{unit}</span>
			{/if}
			{#if subtitle}
				<p class="text-xs text-muted-foreground mt-1">{subtitle}</p>
			{/if}
			{#if change}
				{@const ChangeIcon =
					change.percent > 0 ? TrendingUp : change.percent < 0 ? TrendingDown : Minus}
				{@const tone =
					change.percent === 0
						? 'text-muted-foreground'
						: change.percent > 0 === (change.goodWhen === 'up')
							? 'text-chart-2'
							: 'text-destructive'}
				<!-- Tinted percentage text fails WCAG AA; only the icon takes the direction colour. -->
				<p class="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
					<ChangeIcon class="h-3 w-3 shrink-0 {tone}" aria-hidden="true" />
					<span>
						<span class="font-medium text-foreground">
							{change.percent > 0 ? '+' : ''}{change.percent}%
						</span>
						{change.label}
					</span>
				</p>
			{/if}
		{/if}
	</CardContent>
</Card>
