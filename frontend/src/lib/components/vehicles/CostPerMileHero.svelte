<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import Dial from '#lib/components/charts/Dial.svelte';
	import Drums from '#lib/components/common/Drums.svelte';
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
	const DIAL_STEPS = [1.2, 1.6, 2, 4, 8, 12];
	const FIGURE_LABELS = ['Last 30 days', 'Per month', 'All time'] as const;

	let section = $state<HTMLElement | null>(null);

	let loading = $derived(!summary || distanceLoading);
	let km = $derived(distanceUnit === 'kilometers');
	let unitName = $derived(km ? 'km' : 'mile');
	let unitPlural = $derived(km ? 'km' : 'miles');
	let currency = $derived(settingsStore.settings?.currencyUnit || 'USD');
	let cents = $derived(CENT_CURRENCIES.has(currency));
	let perDistance = $derived(
		summary && !distanceLoading ? costPerDistance(summary.costBuckets, distance) : null
	);
	let owns = $derived(!!perDistance && perDistance.ownership > 0);

	function rate(value: number): string {
		return cents && value < 1 ? `${formatNumberUpTo(value * 100, 0)}¢` : formatCurrency(value);
	}

	function dialMax(value: number, floor: number): number {
		if (!(value > floor) || !Number.isFinite(value)) return floor;
		const magnitude = 10 ** Math.floor(Math.log10(value));
		const step = DIAL_STEPS.find(s => s * magnitude >= value) ?? 12;
		return step * magnitude;
	}

	let dial = $derived.by(() => {
		if (!perDistance) return null;
		const all = owns ? perDistance.total : perDistance.running;
		const inCents = cents && all < 1;
		const factor = inCents ? 100 : 1;
		const running = perDistance.running * factor;
		const ownership = owns ? perDistance.ownership * factor : 0;
		return {
			running,
			ownership,
			value: rate(all),
			max: dialMax(running + ownership, inCents ? 80 : 0.8),
			caption: `ALL-IN ${inCents ? '¢' : currency} / ${km ? 'KM' : 'MI'}`,
			label: owns
				? `True cost per ${unitName}, all in: ${rate(all)}; running ${rate(perDistance.running)}, ownership ${rate(perDistance.ownership)}`
				: `True cost per ${unitName}: ${rate(all)}, all running`
		};
	});

	let over = $derived(`over ${formatNumber(distance ?? 0, 0)} ${unitPlural}`);

	let amounts = $derived(
		summary ? [summary.recentAmount, summary.monthlyAverage, summary.totalAmount] : []
	);
</script>

<section
	class="grid gap-6 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center lg:gap-10"
	aria-label="True cost per {unitName}"
	data-testid="cost-per-mile-hero"
	tabindex="-1"
	bind:this={section}
>
	{#if loading || dial}
		<div class="w-50 justify-self-center lg:w-80">
			{#if dial}
				<Dial
					running={dial.running}
					ownership={dial.ownership}
					max={dial.max}
					valueLabel={dial.value}
					caption={dial.caption}
					label={dial.label}
				/>
			{:else}
				<Skeleton class="aspect-square w-full rounded-full" aria-hidden="true" />
			{/if}
		</div>
	{/if}

	<div class="min-w-0 space-y-4 {loading || dial ? '' : 'sm:col-span-2'}">
		<p class="text-sm text-muted-foreground">What a {unitName} really costs, all in</p>
		{#if loading}
			<div class="min-h-[5.15625rem] space-y-2 lg:min-h-[4.125rem]" aria-hidden="true">
				<Skeleton class="h-6 w-full max-w-md" />
				<Skeleton class="h-6 w-full max-w-sm" />
				<Skeleton class="h-6 w-2/3 max-w-xs lg:hidden" />
			</div>
			<div class="flex h-5 items-center" aria-hidden="true">
				<Skeleton class="h-4 w-56" />
			</div>
			<span class="sr-only">Loading cost per {unitName}</span>
		{:else if perDistance}
			<p
				class="min-h-[5.15625rem] max-w-xl text-xl leading-snug lg:min-h-[4.125rem] lg:text-2xl"
				data-testid="cost-sentence"
			>
				{#if owns}
					{name} costs <strong>{rate(perDistance.total)}</strong> a {unitName}
					{over}: <strong>{rate(perDistance.running)}</strong> to run it and
					<strong>{rate(perDistance.ownership)}</strong> to own it.
				{:else}
					{name} costs <strong>{rate(perDistance.running)}</strong> a {unitName} to run
					{over}. No ownership costs logged yet.
				{/if}
			</p>
			<ul class="flex h-5 flex-wrap gap-x-5 text-sm text-muted-foreground">
				<li class="flex items-center gap-1.5">
					<span
						class="h-2 w-2 shrink-0 rounded-full"
						style:background-color={costBucketColor('upkeep')}
						aria-hidden="true"
					></span>
					Running {rate(perDistance.running)}
				</li>
				{#if owns}
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

		<dl
			class="grid grid-cols-2 gap-x-6 gap-y-4 [container-type:inline-size] sm:flex sm:flex-wrap [&>div:last-child]:col-span-2"
		>
			{#each FIGURE_LABELS as label, i (label)}
				<div class="min-w-0">
					<dt class="mb-1.5 text-sm text-muted-foreground">{label}</dt>
					<dd>
						{#if loading}
							<Skeleton class="h-[2.6rem] w-28 lg:h-[3.4rem] lg:w-32" aria-hidden="true" />
						{:else}
							<Drums amount={amounts[i] ?? 0} {currency} />
						{/if}
					</dd>
				</div>
			{/each}
		</dl>
	</div>
</section>
