<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { routes, paramRoutes } from '#lib/routes.ts';
	import { Gauge, Plus } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import {
		getVolumeUnitLabel,
		getChargeUnitLabel,
		getFuelEfficiencyLabel,
		getElectricEfficiencyLabel
	} from '#lib/utils/units.ts';
	import { formatCurrency, formatDateWith, formatNumber } from '#lib/utils/formatters.ts';
	import {
		bestEfficiency,
		lastTwelveMonths,
		monthOutlier,
		type EconomyPoint
	} from '#lib/utils/fuel-economy.ts';
	import { COMMON_MESSAGES, EXPENSE_MESSAGES } from '#lib/constants/messages.ts';
	import type { UnitPreferences, VehicleStats, VehicleType } from '#lib/types/index.ts';

	interface Props {
		vehicleId: string;
		vehicleStatsData: VehicleStats | null;
		isLoadingStats: boolean;
		unitPreferences?: UnitPreferences | undefined;
		vehicleType?: VehicleType | undefined;
		trend?: EconomyPoint[];
		chart?: Snippet;
	}

	let {
		vehicleId,
		vehicleStatsData,
		isLoadingStats,
		unitPreferences,
		vehicleType,
		trend = [],
		chart
	}: Props = $props();

	const headingId = $props.id();

	let electric = $derived(vehicleType === 'electric');
	let hasFuelData = $derived(
		vehicleStatsData &&
			(vehicleStatsData.fuelExpenseCount > 0 || vehicleStatsData.chargeExpenseCount > 0)
	);
	let units = $derived(unitPreferences ?? settingsStore.unitPreferences);
	let efficiencyUnit = $derived(
		electric
			? getElectricEfficiencyLabel(units.distanceUnit, units.chargeUnit)
			: getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit)
	);
	let decimals = $derived(electric ? 2 : 1);

	let recent = $derived(lastTwelveMonths(trend));
	let average = $derived.by(() => {
		if (recent.length > 0) {
			return recent.reduce((sum, point) => sum + point.efficiency, 0) / recent.length;
		}
		return (electric ? vehicleStatsData?.averageMilesPerKwh : vehicleStatsData?.averageMpg) ?? null;
	});
	let best = $derived(bestEfficiency(recent));
	let pricePerUnit = $derived.by(() => {
		if (!vehicleStatsData) return null;
		const [cost, amount] = electric
			? [vehicleStatsData.totalChargeCost, vehicleStatsData.totalChargeConsumed]
			: [vehicleStatsData.totalFuelCost, vehicleStatsData.totalFuelConsumed];
		return amount > 0 ? cost / amount : null;
	});
	let perUnitLabel = $derived(
		electric
			? getChargeUnitLabel(units.chargeUnit, true)
			: getVolumeUnitLabel(units.volumeUnit, true)
	);

	let insight = $derived.by(() => {
		if (recent.length < 2 || average === null) return null;
		const outlier = monthOutlier(recent, average);
		if (outlier) {
			const month = formatDateWith(outlier.month, { month: 'long' });
			const things = electric ? 'session' : 'tank';
			const verb = outlier.direction === 'below' ? 'dipped' : 'rose';
			return `${month} ${verb} to ${formatNumber(outlier.efficiency, decimals)} ${efficiencyUnit} over ${outlier.count} ${outlier.count === 1 ? things : `${things}s`}.`;
		}
		return `Every month stayed within 15% of the ${formatNumber(average, decimals)} ${efficiencyUnit} average.`;
	});

	let figures = $derived([
		{
			label: `${efficiencyUnit} average`,
			value: average !== null ? formatNumber(average, decimals) : '—'
		},
		{
			label: electric ? 'best session' : 'best tank',
			value: best !== null ? formatNumber(best, decimals) : '—'
		},
		{
			label: `avg per ${perUnitLabel}`,
			value: pricePerUnit !== null ? formatCurrency(pricePerUnit) : '—'
		}
	]);
</script>

{#if hasFuelData || isLoadingStats}
	<section aria-labelledby={headingId} class="space-y-4" data-testid="fuel-economy">
		<div class="flex items-baseline justify-between gap-3">
			<h2 id={headingId} class="text-lg font-semibold">
				{electric ? 'Efficiency' : 'Fuel economy'}
			</h2>
			<span class="text-xs text-muted-foreground">Last 12 months</span>
		</div>
		<dl class="grid grid-cols-3 gap-3">
			{#each figures as figure (figure.label)}
				<div class="flex flex-col-reverse">
					<dt class="text-xs text-muted-foreground">{figure.label}</dt>
					<dd class="text-2xl font-bold tabular-nums">
						{#if isLoadingStats && !hasFuelData}
							<Skeleton class="h-8 w-16" />
						{:else}
							{figure.value}
						{/if}
					</dd>
				</div>
			{/each}
		</dl>
		{@render chart?.()}
		{#if insight}
			<p class="text-sm text-muted-foreground" data-testid="fuel-economy-insight">{insight}</p>
		{/if}
	</section>
{:else if vehicleStatsData}
	<EmptyState>
		{#snippet icon()}
			<Gauge class="h-12 w-12 text-muted-foreground mb-4" />
		{/snippet}
		{#snippet title()}
			{electric ? 'No charging data yet' : COMMON_MESSAGES.NO_FUEL_DATA}
		{/snippet}
		{#snippet description()}
			{electric
				? `Add charging sessions with mileage and ${getChargeUnitLabel(units.chargeUnit, true)} to see detailed charging statistics`
				: EXPENSE_MESSAGES.ADD_FUEL_DESC}
		{/snippet}
		{#snippet action()}
			<Button
				href={`${resolve(routes.expenseNew)}?vehicleId=${vehicleId}&returnTo=${resolve(paramRoutes.vehicle, { id: vehicleId })}&category=fuel`}
			>
				<Plus class="h-4 w-4 mr-2" />
				{electric ? 'Add Charging Session' : COMMON_MESSAGES.ADD_FUEL_EXPENSE}
			</Button>
		{/snippet}
	</EmptyState>
{/if}
