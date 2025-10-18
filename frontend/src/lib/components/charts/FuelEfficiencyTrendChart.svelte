<script lang="ts">
	import { Chart, Svg, Spline, Axis, Tooltip, Highlight } from 'layerchart';
	import {
		Card,
		CardHeader,
		CardTitle,
		CardDescription,
		CardContent
	} from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import EmptyState from '$lib/components/ui/empty-state.svelte';
	import { settingsStore } from '$lib/stores/settings';
	import {
		getFuelEfficiencyLabel,
		getElectricEfficiencyLabel,
		getDistanceUnitLabel
	} from '$lib/utils/units';

	// Chart configuration constants
	const CHART_HEIGHT = 300;
	const CHART_PADDING = { left: 60, bottom: 40, top: 20, right: 20 };
	const MIN_DATA_POINTS = 2;

	interface FuelEfficiencyData {
		date: Date;
		efficiency: number;
		mileage: number;
	}

	interface Props {
		data: FuelEfficiencyData[];
		fuelType: 'gas' | 'diesel' | 'electric' | 'hybrid';
		isLoading?: boolean;
		error?: string | null;
	}

	let { data, fuelType, isLoading = false, error = null }: Props = $props();

	// Efficiency label based on fuel type
	let efficiencyLabel = $derived(
		fuelType === 'electric'
			? getElectricEfficiencyLabel(
					$settingsStore.settings?.distanceUnit || 'miles',
					$settingsStore.settings?.chargeUnit || 'kwh'
				)
			: getFuelEfficiencyLabel(
					$settingsStore.settings?.distanceUnit || 'miles',
					$settingsStore.settings?.volumeUnit || 'gallons_us'
				)
	);

	// Description based on fuel type
	let description = $derived(
		fuelType === 'electric' ? 'Electric efficiency over time' : 'Fuel efficiency over time'
	);

	// Distance unit label
	let distanceLabel = $derived(
		getDistanceUnitLabel($settingsStore.settings?.distanceUnit || 'miles', true)
	);

	// Format date for display (full format for tooltip)
	function formatDate(date: Date): string {
		return new Date(date).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	// Format date for axis (shorter format)
	function formatAxisDate(date: Date): string {
		const d = new Date(date);
		return d.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric'
		});
	}

	// Format mileage with commas
	function formatMileage(mileage: number): string {
		return mileage.toLocaleString('en-US');
	}
</script>

<Card>
	<CardHeader>
		<CardTitle>Fuel Efficiency Trends</CardTitle>
		<CardDescription>{description}</CardDescription>
	</CardHeader>
	<CardContent>
		{#if isLoading}
			<Skeleton class="h-[{CHART_HEIGHT}px] w-full" />
		{:else if error}
			<div class="h-[{CHART_HEIGHT}px]">
				<EmptyState class="h-full">
					{#snippet title()}
						Failed to load chart
					{/snippet}
					{#snippet description()}
						{error}
					{/snippet}
				</EmptyState>
			</div>
		{:else if data.length >= MIN_DATA_POINTS}
			<div class="h-[{CHART_HEIGHT}px]">
				<Chart {data} x="date" y="efficiency" padding={CHART_PADDING}>
					<Svg>
						<Axis placement="bottom" format={formatAxisDate} />
						<Axis placement="left" label={efficiencyLabel} />
						<Spline class="stroke-green-600 stroke-2 fill-none" />
						<Highlight points lines />
					</Svg>
					<Tooltip.Root let:data>
						<Tooltip.Header>
							{formatDate(data.date)}
						</Tooltip.Header>
						<Tooltip.List>
							<Tooltip.Item
								label="Efficiency"
								value={`${data.efficiency.toFixed(1)} ${efficiencyLabel}`}
							/>
							<Tooltip.Item
								label="Odometer"
								value={`${formatMileage(data.mileage)} ${distanceLabel}`}
							/>
						</Tooltip.List>
					</Tooltip.Root>
				</Chart>
			</div>
		{:else}
			<div class="h-[{CHART_HEIGHT}px]">
				<EmptyState class="h-full">
					{#snippet title()}
						Insufficient fuel data
					{/snippet}
					{#snippet description()}
						Add at least {MIN_DATA_POINTS} fuel entries with mileage
					{/snippet}
				</EmptyState>
			</div>
		{/if}
	</CardContent>
</Card>
