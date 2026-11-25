<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Select from '#lib/components/ui/select/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import HeroFigure from '#lib/components/common/hero-figure.svelte';
	import { PERIOD_OPTIONS, isValidPeriod, type TimePeriod } from '#lib/constants/time-periods.ts';
	import { COST_BUCKETS, costBucketColor, type CostBucket } from '#lib/utils/cost-bucket.ts';
	import { formatCurrency } from '#lib/utils/formatters.ts';
	import type { BucketAmounts } from '#lib/utils/cost-bucket.ts';
	import { PERIOD_PHRASES, percentChange } from './dashboard-data';

	interface Props {
		period: TimePeriod;
		total: number;
		previousTotal: number | null;
		buckets: BucketAmounts;
		runningPerDistance: number | null;
		runningScope?: string | null;
		distanceLabel: string;
		isLoading: boolean;
		isUpdating?: boolean;
		onPeriodChange: (_period: TimePeriod) => void;
		actions?: Snippet;
	}

	let {
		period,
		total,
		previousTotal,
		buckets,
		runningPerDistance,
		runningScope = null,
		distanceLabel,
		isLoading,
		isUpdating = false,
		onPeriodChange,
		actions
	}: Props = $props();

	const BUCKET_LABELS: Record<CostBucket, string> = {
		ownership: 'Ownership',
		energy: 'Fuel & charging',
		upkeep: 'Upkeep'
	};

	let phrases = $derived(PERIOD_PHRASES[period]);
	let change = $derived(percentChange(total, previousTotal));
	let bucketTotal = $derived(COST_BUCKETS.reduce((sum, bucket) => sum + buckets[bucket], 0));
	let segments = $derived(
		COST_BUCKETS.filter(bucket => buckets[bucket] > 0).map(bucket => ({
			bucket,
			share: bucketTotal > 0 ? (buckets[bucket] / bucketTotal) * 100 : 0
		}))
	);
</script>

{#snippet periodChip()}
	<Select.Root
		type="single"
		value={period}
		onValueChange={value => {
			if (value && isValidPeriod(value)) onPeriodChange(value);
		}}
	>
		<Select.Trigger
			class="h-10 gap-1.5 rounded-full px-3.5 sm:h-8"
			aria-label="Period: {phrases.chip}"
			disabled={isUpdating || isLoading}
		>
			{phrases.chip}
		</Select.Trigger>
		<Select.Content>
			{#each PERIOD_OPTIONS as option (option.value)}
				<Select.Item value={option.value} label={PERIOD_PHRASES[option.value].chip}>
					{PERIOD_PHRASES[option.value].chip}
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
{/snippet}

<section
	class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-end lg:gap-12"
	data-testid="dashboard-hero"
	aria-label={phrases.label}
	aria-busy={isLoading}
>
	<div class="space-y-4">
		<HeroFigure label={phrases.label} value={isLoading ? '\u00a0' : formatCurrency(total)}>
			{#snippet action()}
				{@render periodChip()}
			{/snippet}
			{#snippet meta()}
				<div class="flex min-h-9 flex-col gap-y-1 sm:min-h-4 sm:flex-row sm:gap-x-2">
					{#if isLoading}
						<Skeleton class="h-4 w-48" />
						<Skeleton class="h-4 w-32" />
					{:else}
						{#if change !== null}
							<span>
								<span class="font-medium text-foreground">
									{change === 0
										? 'The same as'
										: `${Math.abs(change)}% ${change < 0 ? 'less' : 'more'} than`}
								</span>
								{phrases.previous}
							</span>
						{/if}
						{#if runningPerDistance !== null}
							<span>
								<span class="font-medium text-foreground">
									{formatCurrency(runningPerDistance)}/{distanceLabel}
								</span>
								running cost{runningScope ? ` ${runningScope}` : ''}
							</span>
						{/if}
					{/if}
				</div>
			{/snippet}
		</HeroFigure>
	</div>

	{#if isLoading || bucketTotal > 0}
		<div>
			{#if isLoading}
				<div class="space-y-2" data-testid="dashboard-hero-skeleton">
					<Skeleton class="h-2.5 w-full rounded-full" />
					<div class="grid grid-cols-1 gap-y-1 sm:flex sm:gap-x-4">
						<Skeleton class="h-4 w-36" />
						<Skeleton class="h-4 w-36" />
						<Skeleton class="h-4 w-28" />
					</div>
				</div>
			{:else if bucketTotal > 0}
				<div class="space-y-3">
					<ul class="flex flex-wrap justify-between gap-x-6 gap-y-3" role="list">
						{#each COST_BUCKETS as bucket (bucket)}
							<li class="flex flex-col gap-1">
								<span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
									<span
										class="size-2 shrink-0 rounded-full"
										style:background-color={costBucketColor(bucket)}
										aria-hidden="true"
									></span>
									{BUCKET_LABELS[bucket]}
								</span>
								<span class="text-xl font-semibold text-foreground tabular-nums">
									{formatCurrency(buckets[bucket], undefined, 0)}
								</span>
							</li>
						{/each}
					</ul>
					<div class="flex h-2 w-full gap-1" aria-hidden="true" data-testid="dashboard-split-bar">
						{#each segments as segment (segment.bucket)}
							<span
								class="h-full rounded-full"
								style:width="{segment.share}%"
								style:background-color={costBucketColor(segment.bucket)}
							></span>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}

	{#if actions}
		<div class="lg:col-start-1">{@render actions()}</div>
	{/if}
</section>
