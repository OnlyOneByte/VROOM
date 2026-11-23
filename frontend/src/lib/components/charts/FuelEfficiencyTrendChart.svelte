<script lang="ts">
	import type * as Chart from '#lib/components/ui/chart/index.ts';
	import AppLineChart from './AppLineChart.svelte';
	import { formatDecimalAxis, formatDayLabel, unitTooltip } from '#lib/utils/chart-formatters.ts';
	import { getFuelEfficiencyLabel, getElectricEfficiencyLabel } from '#lib/utils/units.ts';
	import type { UnitPreferences, VehicleType } from '#lib/types/index.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';

	interface FuelEfficiencyData {
		date: Date;
		efficiency: number;
		mileage: number;
		[key: string]: unknown;
	}

	interface Props {
		data: FuelEfficiencyData[];
		fuelType: VehicleType;
		unitPreferences?: UnitPreferences;
		isLoading?: boolean;
		error?: string | null;
	}

	let { data, fuelType, unitPreferences, isLoading = false, error = null }: Props = $props();

	let units = $derived(unitPreferences ?? settingsStore.unitPreferences);

	let title = $derived(fuelType === 'electric' ? 'Electric Efficiency' : 'Fuel Efficiency');
	let unitLabel = $derived(
		fuelType === 'electric'
			? getElectricEfficiencyLabel(units.distanceUnit, units.chargeUnit)
			: getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit)
	);
	let description = $derived(`Measured in ${unitLabel}`);
	let tooltipFormat = $derived(unitTooltip(unitLabel));

	const chartConfig: Chart.ChartConfig = {
		efficiency: { label: 'Efficiency', color: 'var(--chart-2)' }
	};

	const series = [{ key: 'efficiency', label: 'Efficiency', color: 'var(--chart-2)' }];
</script>

<AppLineChart
	{title}
	{description}
	{data}
	x="date"
	y="efficiency"
	{series}
	config={chartConfig}
	{isLoading}
	{error}
	height={280}
	yAxisFormat={formatDecimalAxis}
	{tooltipFormat}
	tooltipLabelFormat={formatDayLabel}
	emptyTitle="Insufficient fuel data"
	emptyDescription="Add at least 2 fuel entries with mileage and volume to calculate efficiency"
/>
