<script lang="ts">
	import HeroFigure from '#lib/components/common/hero-figure.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import type { ExpenseSummary, Vehicle } from '#lib/types/index.ts';
	import type { DistanceUnit } from '#lib/types/settings.ts';
	import { formatCurrency, formatNumber } from '#lib/utils/formatters.ts';
	import { COST_BUCKETS, type CostBucket } from '#lib/utils/cost-bucket.ts';
	import { bucketAmounts, costPerDistance } from '#lib/utils/cost-per-distance.ts';

	interface Props {
		summary: ExpenseSummary | null;
		distance: number | null;
		distanceUnit: DistanceUnit;
		vehicleType: Vehicle['vehicleType'];
		logMileageHref?: string | undefined;
	}

	let { summary, distance, distanceUnit, vehicleType, logMileageHref }: Props = $props();

	const BAR_CLASS: Record<CostBucket, string> = {
		ownership: 'bg-chart-3',
		energy: 'bg-chart-1',
		upkeep: 'bg-chart-2'
	};

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
		upkeep: 'Upkeep and fees'
	});
	let shownBuckets = $derived(buckets ? COST_BUCKETS.filter(bucket => buckets[bucket] > 0) : []);
</script>

<section
	class="space-y-4 rounded-xl border bg-card p-4 sm:p-6"
	aria-label="True cost per {unitName}"
	data-testid="cost-per-mile-hero"
>
	{#if !summary}
		<div class="space-y-1" aria-hidden="true">
			<Skeleton class="h-5 w-44" />
			<Skeleton class="h-10 w-32 lg:h-12" />
			<Skeleton class="h-4 w-56" />
		</div>
		<Skeleton class="h-2 w-full" />
		<div class="grid grid-cols-3 gap-3" aria-hidden="true">
			{#each Array(3) as _, i (i)}
				<div class="space-y-1">
					<Skeleton class="h-4 w-16" />
					<Skeleton class="h-6 w-20" />
				</div>
			{/each}
		</div>
		<span class="sr-only">Loading cost per {unitName}</span>
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
					<span>
						over {formatNumber(distance ?? 0, 0)}
						{distanceUnit === 'kilometers' ? 'km' : 'mi'}
					</span>
				{/snippet}
			</HeroFigure>
		{:else}
			<div class="space-y-1">
				<p class="text-sm text-muted-foreground">True cost per {unitName}, all time</p>
				<p class="text-lg font-semibold">Log a mileage to see cost per {unitName}</p>
				<p class="text-xs text-muted-foreground">
					It divides every cost so far by the distance since you added this vehicle.
				</p>
				{#if logMileageHref}
					<Button variant="outline" size="sm" class="mt-2" href={logMileageHref}>
						Add an odometer reading
					</Button>
				{/if}
			</div>
		{/if}

		{#if buckets && bucketTotal > 0}
			<div class="space-y-2">
				<div class="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
					{#each shownBuckets as bucket (bucket)}
						<div
							class={BAR_CLASS[bucket]}
							style:width="{(buckets[bucket] / bucketTotal) * 100}%"
							data-bucket={bucket}
						></div>
					{/each}
				</div>
				<ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
					{#each shownBuckets as bucket (bucket)}
						<li class="flex items-center gap-1.5">
							<span class="h-2 w-2 shrink-0 rounded-full {BAR_CLASS[bucket]}" aria-hidden="true"
							></span>
							{bucketLabels[bucket]}
							<span class="tabular-nums text-foreground">{formatCurrency(buckets[bucket])}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<dl class="grid grid-cols-3 gap-3">
			<div>
				<dt class="text-xs text-muted-foreground">Last 30 days</dt>
				<dd class="text-lg font-semibold tabular-nums">{formatCurrency(summary.recentAmount)}</dd>
			</div>
			<div>
				<dt class="text-xs text-muted-foreground">Per month</dt>
				<dd class="text-lg font-semibold tabular-nums">
					{formatCurrency(summary.monthlyAverage, undefined, 0)}
				</dd>
			</div>
			<div>
				<dt class="text-xs text-muted-foreground">All time</dt>
				<dd class="text-lg font-semibold tabular-nums">
					{formatCurrency(summary.totalAmount, undefined, 0)}
				</dd>
			</div>
		</dl>
	{/if}
</section>
