<script lang="ts">
	import type * as Chart from '#lib/components/ui/chart/index.ts';
	import AppLineChart from './AppLineChart.svelte';
	import { formatDecimalAxis, formatDayLabel, unitTooltip } from '#lib/utils/chart-formatters.ts';
	import {
		getChargeUnitLabel,
		getFuelEfficiencyLabel,
		getElectricEfficiencyLabel
	} from '#lib/utils/units.ts';
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
		level?: 2 | 3 | 4;
		referenceLines?: Array<{ value: number; label: string }>;
	}

	let {
		data,
		fuelType,
		unitPreferences,
		isLoading = false,
		error = null,
		level,
		referenceLines = []
	}: Props = $props();

	let units = $derived(unitPreferences ?? settingsStore.unitPreferences);

	let title = $derived(fuelType === 'electric' ? 'Electric Efficiency' : 'Fuel Efficiency');
	let unitLabel = $derived(
		fuelType === 'electric'
			? getElectricEfficiencyLabel(units.distanceUnit, units.chargeUnit)
			: getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit)
	);
	let description = $derived(`Measured in ${unitLabel}`);
	let tooltipFormat = $derived(unitTooltip(unitLabel));
	let emptyTitle = $derived(
		fuelType === 'electric' ? 'Insufficient charging data' : 'Insufficient fuel data'
	);
	let emptyDescription = $derived(
		fuelType === 'electric'
			? `Add at least 2 charging sessions with mileage and ${getChargeUnitLabel(units.chargeUnit, true)} to calculate efficiency`
			: 'Add at least 2 fuel entries with mileage and volume to calculate efficiency'
	);

	const chartConfig: Chart.ChartConfig = {
		efficiency: { label: 'Efficiency', color: 'var(--chart-2)' }
	};

	const series = [{ key: 'efficiency', label: 'Efficiency', color: 'var(--chart-2)' }];
</script>

<AppLineChart
	{title}
	{level}
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
	{emptyTitle}
	{emptyDescription}
	{referenceLines}
/>
