<script lang="ts" module>
	const instruments = Promise.all([
		import('#lib/components/charts/Dial.svelte'),
		import('#lib/components/common/Drums.svelte')
	]);
</script>

<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import type { ExpenseSummary } from '#lib/types/index.ts';
	import type { DistanceUnit } from '#lib/types/settings.ts';
	import { formatCurrency, formatNumber, formatNumberUpTo } from '#lib/utils/formatters.ts';
	import { costBucketColor } from '#lib/utils/cost-bucket.ts';
	import { costPerDistance } from '#lib/utils/cost-per-distance.ts';

	interface Props {
		summary: ExpenseSummary | null;
		distance: number | null;
		distanceLoading?: boolean;
		distanceError?: string | null;
		distanceUnit: DistanceUnit;
		name?: string;
		logMileageHref?: string | undefined;
		onRetryDistance?: (() => unknown) | undefined;
	}

	let {
		summary,
		distance,
		distanceLoading = false,
		distanceError = null,
		distanceUnit,
		name = 'This car',
		logMileageHref,
		onRetryDistance
	}: Props = $props();

	const CENT_CURRENCIES = new Set(['USD', 'CAD', 'AUD', 'NZD']);
	const DIAL_STEPS = [1, 1.6, 2, 4, 8];

	let section = $state<HTMLElement | null>(null);

	let km = $derived(distanceUnit === 'kilometers');
	let unitName = $derived(km ? 'km' : 'mile');
	let unitPlural = $derived(km ? 'km' : 'miles');
	let currency = $derived(settingsStore.settings?.currencyUnit || 'USD');
	let cents = $derived(CENT_CURRENCIES.has(currency));
	let perDistance = $derived(summary ? costPerDistance(summary.costBuckets, distance) : null);

	function rate(value: number): string {
		return cents ? `${formatNumberUpTo(value * 100, 0)}¢` : formatCurrency(value);
	}

	function dialMax(value: number, floor: number): number {
		if (!(value > floor)) return floor;
		const magnitude = 10 ** Math.floor(Math.log10(value));
		const step = DIAL_STEPS.find(s => s * magnitude >= value) ?? 10;
		return step * magnitude;
	}

	let dial = $derived.by(() => {
		if (!perDistance) return null;
		const factor = cents ? 100 : 1;
		const running = perDistance.running * factor;
		const ownership = perDistance.ownership * factor;
		return {
			running,
			ownership,
			max: dialMax(running + Math.max(ownership, 0), cents ? 80 : 0.8),
			caption: `ALL-IN ${cents ? '¢' : currency} / ${km ? 'KM' : 'MI'}`
		};
	});

	let over = $derived(`over ${formatNumber(distance ?? 0, 0)} ${unitPlural}`);

	let figures = $derived(
		summary
			? [
					{ label: 'Last 30 days', amount: summary.recentAmount },
					{ label: 'Per month', amount: summary.monthlyAverage },
					{ label: 'All time', amount: summary.totalAmount }
				]
			: []
	);
</script>

{#snippet drumsPlaceholder()}
	<Skeleton class="h-10 w-24 lg:h-12" aria-hidden="true" />
{/snippet}

<section
	class="grid gap-6 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center lg:gap-10"
	aria-label="True cost per {unitName}"
	data-testid="cost-per-mile-hero"
	tabindex="-1"
	bind:this={section}
>
	{#if !summary || distanceLoading}
		<Skeleton
			class="aspect-square w-full max-w-50 justify-self-center rounded-full lg:max-w-80"
			aria-hidden="true"
		/>
		<div class="space-y-4">
			<div class="space-y-2" aria-hidden="true">
				<Skeleton class="h-4 w-44" />
				<Skeleton class="h-7 w-full max-w-md" />
				<Skeleton class="h-7 w-3/4 max-w-sm" />
			</div>
			<span class="sr-only">Loading cost per {unitName}</span>
			<div class="flex flex-wrap gap-4" aria-hidden="true">
				{#each Array(3) as _, i (i)}
					{@render drumsPlaceholder()}
				{/each}
			</div>
		</div>
	{:else}
		{#if dial}
			<div class="flex justify-center">
				{#await instruments}
					<Skeleton
						class="aspect-square w-full max-w-50 rounded-full lg:max-w-80"
						aria-hidden="true"
					/>
				{:then [{ default: Dial }]}
					<Dial
						running={dial.running}
						ownership={dial.ownership}
						max={dial.max}
						valueLabel={rate(perDistance?.total ?? 0)}
						caption={dial.caption}
						label="True cost per {unitName}, all in: {rate(perDistance?.total ?? 0)}"
					/>
				{/await}
			</div>
		{/if}

		<div class="min-w-0 space-y-4 {dial ? '' : 'sm:col-span-2'}">
			<p class="text-sm text-muted-foreground">What a {unitName} really costs, all in</p>
			{#if perDistance}
				<p class="max-w-xl text-xl leading-snug lg:text-2xl" data-testid="cost-sentence">
					{#if perDistance.ownership > 0}
						{name} costs <strong>{rate(perDistance.total)}</strong> a {unitName}
						{over}: <strong>{rate(perDistance.running)}</strong> to run it and
						<strong>{rate(perDistance.ownership)}</strong> to own it.
					{:else}
						{name} costs <strong>{rate(perDistance.total)}</strong> a {unitName} to run
						{over}. No ownership costs logged yet.
					{/if}
				</p>
				<ul class="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
					<li class="flex items-center gap-1.5">
						<span
							class="h-2 w-2 shrink-0 rounded-full"
							style:background-color={costBucketColor('upkeep')}
							aria-hidden="true"
						></span>
						Running {rate(perDistance.running)}
					</li>
					{#if perDistance.ownership > 0}
						<li class="flex items-center gap-1.5">
							<span
								class="h-2 w-2 shrink-0 rounded-full"
								style:background-color={costBucketColor('ownership')}
								aria-hidden="true"
							></span>
							Ownership {rate(perDistance.ownership)}
						</li>
					{/if}
				</ul>
			{:else if distanceError && onRetryDistance}
				<LoadErrorCard
					compact
					title="Cost per {unitName} isn't available right now"
					message={distanceError}
					onRetry={onRetryDistance}
					onRecovered={() => section?.focus()}
					data-testid="cost-per-mile-error"
				/>
			{:else}
				<div class="space-y-1">
					<p class="text-lg font-semibold">
						Log a newer odometer reading to see cost per {unitName}
					</p>
					<p class="text-sm text-muted-foreground">
						It divides every cost so far by the distance since you added this vehicle.
					</p>
					{#if logMileageHref}
						<Button variant="outline" size="sm" class="mt-2" href={logMileageHref}>
							Add an odometer reading
						</Button>
					{/if}
				</div>
			{/if}

			<dl class="flex flex-wrap gap-x-6 gap-y-4 [container-type:inline-size]">
				{#each figures as figure (figure.label)}
					<div class="min-w-0">
						<dt class="mb-1.5 text-sm text-muted-foreground">{figure.label}</dt>
						<dd>
							{#await instruments}
								{@render drumsPlaceholder()}
							{:then [, { default: Drums }]}
								<Drums amount={figure.amount} {currency} />
							{/await}
						</dd>
					</div>
				{/each}
			</dl>
		</div>
	{/if}
</section>
