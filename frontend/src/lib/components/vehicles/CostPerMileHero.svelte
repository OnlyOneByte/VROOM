<script lang="ts">
	import HeroFigure from '#lib/components/common/hero-figure.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import type { ExpenseSummary, Vehicle } from '#lib/types/index.ts';
	import type { DistanceUnit } from '#lib/types/settings.ts';
	import { formatCurrency, formatNumber } from '#lib/utils/formatters.ts';
	import {
		COST_BUCKETS,
		COST_BUCKET_COLOR_TOKENS,
		type CostBucket
	} from '#lib/utils/cost-bucket.ts';
	import { bucketAmounts, costPerDistance } from '#lib/utils/cost-per-distance.ts';

	interface Props {
		summary: ExpenseSummary | null;
		distance: number | null;
		distanceLoading?: boolean;
		distanceUnavailable?: boolean;
		distanceUnit: DistanceUnit;
		vehicleType: Vehicle['vehicleType'];
		logMileageHref?: string | undefined;
	}

	let {
		summary,
		distance,
		distanceLoading = false,
		distanceUnavailable = false,
		distanceUnit,
		vehicleType,
		logMileageHref
	}: Props = $props();

	const BG_BY_TOKEN: Record<(typeof COST_BUCKET_COLOR_TOKENS)[CostBucket], string> = {
		'chart-1': 'bg-chart-1',
		'chart-2': 'bg-chart-2',
		'chart-3': 'bg-chart-3',
		'chart-4': 'bg-chart-4',
		'chart-5': 'bg-chart-5'
	};
	const bucketBg = (bucket: CostBucket) => BG_BY_TOKEN[COST_BUCKET_COLOR_TOKENS[bucket]];

	let unitName = $derived(distanceUnit === 'kilometers' ? 'km' : 'mile');
	let perDistance = $derived(summary ? costPerDistance(summary.costBuckets, distance) : null);
	let buckets = $derived(summary ? bucketAmounts(summary.categoryBreakdown) : null);
	let bucketTotal = $derived(
		buckets ? COST_BUCKETS.reduce((sum, bucket) => sum + buckets[bucket], 0) : 0
	);
	let bucketLabels = $derived<Record<CostBucket, string>>({
		ownership: 'Ownership',
		energy:
			vehicleType === 'electric'
				? 'Charging'
				: vehicleType === 'hybrid'
					? 'Fuel and charging'
					: 'Fuel',
		upkeep: 'Upkeep'
	});
	let shownBuckets = $derived(buckets ? COST_BUCKETS.filter(bucket => buckets[bucket] > 0) : []);
</script>

<section
	class="space-y-4 rounded-xl border bg-card p-4 sm:p-6"
	aria-label="True cost per {unitName}"
	data-testid="cost-per-mile-hero"
>
	{#if !summary || distanceLoading}
		<div class="space-y-1">
			<div class="flex min-h-7 items-center" aria-hidden="true">
				<Skeleton class="h-4 w-44" />
			</div>
			<Skeleton class="h-[2.8125rem] w-32 lg:h-[3.75rem]" aria-hidden="true" />
			<div class="flex flex-wrap gap-y-1" aria-hidden="true">
				<Skeleton class="h-4 w-56" />
				<Skeleton class="h-4 w-24 basis-full sm:hidden" />
			</div>
			<span class="sr-only">Loading cost per {unitName}</span>
		</div>
		<div class="space-y-2" aria-hidden="true">
			<Skeleton class="h-2 w-full" />
			<div class="grid grid-cols-3 gap-3">
				{#each Array(3) as _, i (i)}
					<div class="space-y-0.5">
						<Skeleton class="h-4 w-14" />
						<Skeleton class="h-4 w-16" />
					</div>
				{/each}
			</div>
		</div>
		<div class="grid grid-cols-3 gap-3" aria-hidden="true">
			{#each Array(3) as _, i (i)}
				<div>
					<Skeleton class="h-4 w-16" />
					<Skeleton class="mt-0.5 h-7 w-20" />
				</div>
			{/each}
		</div>
	{:else}
		{#if perDistance}
			<HeroFigure
				label="True cost per {unitName}, all time"
				value={formatCurrency(perDistance.total)}
			>
				{#snippet meta()}
					<span>
						{formatCurrency(perDistance.running)} running
						{#if perDistance.ownership > 0}
							+ {formatCurrency(perDistance.ownership)} ownership
						{:else}
							· no ownership costs logged
						{/if}
					</span>
					<span class="max-sm:hidden" aria-hidden="true">·</span>
					<span class="whitespace-nowrap max-sm:basis-full">
						over {formatNumber(distance ?? 0, 0)}
						{distanceUnit === 'kilometers' ? 'km' : 'mi'}
					</span>
				{/snippet}
			</HeroFigure>
		{:else}
			<div class="space-y-1">
				<p class="text-sm text-muted-foreground">True cost per {unitName}, all time</p>
				{#if distanceUnavailable}
					<p class="text-lg font-semibold">Cost per {unitName} isn't available right now</p>
					<p class="text-xs text-muted-foreground">
						The odometer readings didn't load. Reload the page to try again.
					</p>
				{:else}
					<p class="text-lg font-semibold">
						Log a newer odometer reading to see cost per {unitName}
					</p>
					<p class="text-xs text-muted-foreground">
						It divides every cost so far by the distance since you added this vehicle.
					</p>
					{#if logMileageHref}
						<Button variant="outline" size="sm" class="mt-2" href={logMileageHref}>
							Add an odometer reading
						</Button>
					{/if}
				{/if}
			</div>
		{/if}

		{#if buckets && bucketTotal > 0}
			<div class="space-y-2">
				<div class="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
					{#each shownBuckets as bucket (bucket)}
						<div
							class={bucketBg(bucket)}
							style:width="{(buckets[bucket] / bucketTotal) * 100}%"
							data-bucket={bucket}
						></div>
					{/each}
				</div>
				<ul class="grid grid-cols-3 gap-3 text-xs text-muted-foreground">
					{#each shownBuckets as bucket (bucket)}
						<li class="min-w-0 space-y-0.5">
							<span class="flex items-center gap-1.5">
								<span class="h-2 w-2 shrink-0 rounded-full {bucketBg(bucket)}" aria-hidden="true"
								></span>
								<span class="truncate">{bucketLabels[bucket]}</span>
							</span>
							<span class="block tabular-nums text-foreground">
								{formatCurrency(buckets[bucket])}
							</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<dl class="grid grid-cols-3 gap-3">
			<div>
				<dt class="text-xs text-muted-foreground">Last 30 days</dt>
				<dd class="mt-0.5 text-lg font-semibold tabular-nums">
					{formatCurrency(summary.recentAmount)}
				</dd>
			</div>
			<div>
				<dt class="text-xs text-muted-foreground">Per month</dt>
				<dd class="mt-0.5 text-lg font-semibold tabular-nums">
					{formatCurrency(summary.monthlyAverage, undefined, 0)}
				</dd>
			</div>
			<div>
				<dt class="text-xs text-muted-foreground">All time</dt>
				<dd class="mt-0.5 text-lg font-semibold tabular-nums">
					{formatCurrency(summary.totalAmount, undefined, 0)}
				</dd>
			</div>
		</dl>
	{/if}
</section>
