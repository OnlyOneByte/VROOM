<script lang="ts">
	import './line-chart-animations.css';
	import { animateOnView } from '$lib/utils/animate-on-view';
	import { AreaChart, LineChart } from 'layerchart';
	import * as Card from '$lib/components/ui/card';
	import * as Chart from '$lib/components/ui/chart';
	import {
		formatCurrencyAxis,
		formatDecimalAxis,
		formatCentsAxis,
		formatDateTick,
		CHART_PADDING,
		CHART_PADDING_WIDE,
		TREND_LINE_PROPS,
		monthlyXAxisProps,
		getXTickCount
	} from '$lib/utils/chart-formatters';
	import type { FuelStatsResponse } from '$lib/types';

	const CHART_COLORS = [
		'var(--chart-1)',
		'var(--chart-2)',
		'var(--chart-3)',
		'var(--chart-4)',
		'var(--chart-5)'
	] as const;

	interface Props {
		fuelStats: FuelStatsResponse;
	}

	let { fuelStats }: Props = $props();

	// --- 1. Fuel Consumption (MPG + Gallons) ---
	let consumptionData = $derived(
		fuelStats.monthlyConsumption.map(d => ({ ...d, date: parseMonthToDate(d.month) }))
	);

	let consumptionSeries = $derived([
		{ key: 'mpg', label: 'MPG', color: CHART_COLORS[0] },
		{ key: 'gallons', label: 'Gallons', color: CHART_COLORS[1] }
	]);

	const consumptionConfig: Chart.ChartConfig = {
		mpg: { label: 'MPG', color: 'var(--chart-1)' },
		gallons: { label: 'Gallons', color: 'var(--chart-2)' }
	};

	// --- 2. Gas Price History ---
	let gasPriceFuelTypes = $derived([...new Set(fuelStats.gasPriceHistory.map(d => d.fuelType))]);

	let gasPriceData = $derived.by(() => {
		const byDate = new Map<string, Record<string, number | string | Date>>();
		for (const item of fuelStats.gasPriceHistory) {
			if (!byDate.has(item.date))
				byDate.set(item.date, { dateStr: item.date, date: parseDateString(item.date) });
			const row = byDate.get(item.date)!;
			row[item.fuelType] = item.pricePerGallon;
		}
		return Array.from(byDate.values()).sort((a, b) =>
			String(a['dateStr']).localeCompare(String(b['dateStr']))
		);
	});

	let gasPriceSeries = $derived(
		gasPriceFuelTypes.map((name, i) => ({
			key: name,
			label: name,
			color: CHART_COLORS[i % CHART_COLORS.length]
		}))
	);

	let gasPriceConfig = $derived.by(() => {
		const config: Chart.ChartConfig = {};
		for (const s of gasPriceSeries) {
			config[s.key] = { label: s.label, color: s.color };
		}
		return config;
	});

	// --- 3. Fill-up Cost by Vehicle ---
	let costVehicleNames = $derived([
		...new Set(fuelStats.fillupCostByVehicle.map(d => d.vehicleName))
	]);

	let fillupCostData = $derived.by(() => {
		const byMonth = new Map<string, Record<string, number | string | Date>>();
		for (const item of fuelStats.fillupCostByVehicle) {
			if (!byMonth.has(item.month))
				byMonth.set(item.month, { month: item.month, date: parseMonthToDate(item.month) });
			const row = byMonth.get(item.month)!;
			row[item.vehicleName] = item.avgCost;
		}
		return Array.from(byMonth.values()).sort((a, b) =>
			String(a['month']).localeCompare(String(b['month']))
		);
	});

	let fillupCostSeries = $derived(
		costVehicleNames.map((name, i) => ({
			key: name,
			label: name,
			color: CHART_COLORS[i % CHART_COLORS.length]
		}))
	);

	let fillupCostConfig = $derived.by(() => {
		const config: Chart.ChartConfig = {};
		for (const s of fillupCostSeries) {
			config[s.key] = { label: s.label, color: s.color };
		}
		return config;
	});

	// --- 4. Odometer Progression ---
	let odometerVehicleNames = $derived([
		...new Set(fuelStats.odometerProgression.map(d => d.vehicleName))
	]);

	let odometerData = $derived.by(() => {
		const byMonth = new Map<string, Record<string, number | string | Date>>();
		for (const item of fuelStats.odometerProgression) {
			if (!byMonth.has(item.month))
				byMonth.set(item.month, { month: item.month, date: parseMonthToDate(item.month) });
			const row = byMonth.get(item.month)!;
			row[item.vehicleName] = item.mileage;
		}
		return Array.from(byMonth.values()).sort((a, b) =>
			String(a['month']).localeCompare(String(b['month']))
		);
	});

	let odometerSeries = $derived(
		odometerVehicleNames.map((name, i) => ({
			key: name,
			label: name,
			color: CHART_COLORS[i % CHART_COLORS.length]
		}))
	);

	let odometerConfig = $derived.by(() => {
		const config: Chart.ChartConfig = {};
		for (const s of odometerSeries) {
			config[s.key] = { label: s.label, color: s.color };
		}
		return config;
	});

	// --- 5. Cost per Mile ---
	let cpmVehicleNames = $derived([...new Set(fuelStats.costPerMile.map(d => d.vehicleName))]);

	let costPerMileData = $derived.by(() => {
		const byMonth = new Map<string, Record<string, number | string | Date>>();
		for (const item of fuelStats.costPerMile) {
			if (!byMonth.has(item.month))
				byMonth.set(item.month, { month: item.month, date: parseMonthToDate(item.month) });
			const row = byMonth.get(item.month)!;
			row[item.vehicleName] = item.costPerMile;
		}
		return Array.from(byMonth.values()).sort((a, b) =>
			String(a['month']).localeCompare(String(b['month']))
		);
	});

	let costPerMileSeries = $derived(
		cpmVehicleNames.map((name, i) => ({
			key: name,
			label: name,
			color: CHART_COLORS[i % CHART_COLORS.length]
		}))
	);

	let costPerMileConfig = $derived.by(() => {
		const config: Chart.ChartConfig = {};
		for (const s of costPerMileSeries) {
			config[s.key] = { label: s.label, color: s.color };
		}
		return config;
	});

	function parseMonthToDate(month: string): Date {
		const [y, m] = month.split('-');
		return new Date(Number(y), Number(m) - 1, 1);
	}

	function parseDateString(dateStr: string): Date {
		return new Date(dateStr);
	}
</script>

<div class="space-y-6">
	<!-- 1. Fuel Consumption (MPG + Gallons) -->
	<Card.Root>
		<Card.Header>
			<Card.Title>Fuel Consumption</Card.Title>
			<Card.Description>Monthly MPG and gallons used</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if consumptionData.length > 0}
				<div use:animateOnView={'chart-line-animated'}>
					<Chart.Container config={consumptionConfig} class="h-[300px] w-full">
						<LineChart
							data={consumptionData}
							x="date"
							y={['mpg', 'gallons']}
							series={consumptionSeries}
							padding={CHART_PADDING}
							props={{
								...TREND_LINE_PROPS,
								xAxis: monthlyXAxisProps(consumptionData.length),
								yAxis: { format: (v: number) => formatDecimalAxis(v) }
							}}
						>
							{#snippet tooltip()}
								<Chart.Tooltip hideLabel />
							{/snippet}
						</LineChart>
					</Chart.Container>
				</div>
				<div
					class="mt-3 flex flex-wrap items-center justify-center gap-4 text-sm"
					role="list"
					aria-label="Fuel consumption legend"
				>
					<div class="flex items-center gap-2" role="listitem">
						<div
							class="h-3 w-3 rounded-sm"
							style="background-color: var(--chart-1)"
							aria-hidden="true"
						></div>
						<span class="text-muted-foreground">MPG</span>
					</div>
					<div class="flex items-center gap-2" role="listitem">
						<div
							class="h-3 w-3 rounded-sm"
							style="background-color: var(--chart-2)"
							aria-hidden="true"
						></div>
						<span class="text-muted-foreground">Gallons</span>
					</div>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground text-center py-8">No consumption data available</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- 2. Gas Price on Fill-up -->
	<Card.Root>
		<Card.Header>
			<Card.Title>Gas Price on Fill-up</Card.Title>
			<Card.Description>Price per gallon by fuel type over time</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if gasPriceData.length > 0}
				<div use:animateOnView={'chart-line-animated'}>
					<Chart.Container config={gasPriceConfig} class="h-[300px] w-full">
						<LineChart
							data={gasPriceData}
							x="date"
							y={gasPriceFuelTypes}
							series={gasPriceSeries}
							padding={CHART_PADDING}
							props={{
								...TREND_LINE_PROPS,
								xAxis: {
									ticks: getXTickCount(gasPriceData.length, 6),
									format: formatDateTick
								},
								yAxis: { format: formatCurrencyAxis }
							}}
						>
							{#snippet tooltip()}
								<Chart.Tooltip hideLabel />
							{/snippet}
						</LineChart>
					</Chart.Container>
				</div>
				<div
					class="mt-3 flex flex-wrap items-center justify-center gap-4 text-sm"
					role="list"
					aria-label="Gas price legend"
				>
					{#each gasPriceSeries as s (s.key)}
						<div class="flex items-center gap-2" role="listitem">
							<div
								class="h-3 w-3 rounded-sm"
								style="background-color: {s.color}"
								aria-hidden="true"
							></div>
							<span class="text-muted-foreground">{s.label}</span>
						</div>
					{/each}
				</div>
			{:else}
				<p class="text-sm text-muted-foreground text-center py-8">No gas price data available</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- 3. Fill-up Cost by Vehicle -->
	<Card.Root>
		<Card.Header>
			<Card.Title>Fill-up Cost by Vehicle</Card.Title>
			<Card.Description>Average fill-up cost per vehicle over time</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if fillupCostData.length > 0}
				<div use:animateOnView={'chart-line-animated'}>
					<Chart.Container config={fillupCostConfig} class="h-[300px] w-full">
						<LineChart
							data={fillupCostData}
							x="date"
							y={costVehicleNames}
							series={fillupCostSeries}
							padding={CHART_PADDING}
							props={{
								...TREND_LINE_PROPS,
								xAxis: monthlyXAxisProps(fillupCostData.length),
								yAxis: { format: formatCurrencyAxis }
							}}
						>
							{#snippet tooltip()}
								<Chart.Tooltip hideLabel />
							{/snippet}
						</LineChart>
					</Chart.Container>
				</div>
				<div
					class="mt-3 flex flex-wrap items-center justify-center gap-4 text-sm"
					role="list"
					aria-label="Fill-up cost legend"
				>
					{#each fillupCostSeries as s (s.key)}
						<div class="flex items-center gap-2" role="listitem">
							<div
								class="h-3 w-3 rounded-sm"
								style="background-color: {s.color}"
								aria-hidden="true"
							></div>
							<span class="text-muted-foreground">{s.label}</span>
						</div>
					{/each}
				</div>
			{:else}
				<p class="text-sm text-muted-foreground text-center py-8">No fill-up cost data available</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- 4. Total Odometer + 5. Cost per Mile: 2-col grid -->
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
		<!-- 4. Total Odometer -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Total Odometer</Card.Title>
				<Card.Description>Mileage progression per vehicle</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if odometerData.length > 0}
					<div use:animateOnView={'chart-line-animated'}>
						<Chart.Container config={odometerConfig} class="h-[300px] w-full">
							<AreaChart
								data={odometerData}
								x="date"
								y={odometerVehicleNames}
								series={odometerSeries}
								padding={CHART_PADDING_WIDE}
								props={{
									xAxis: monthlyXAxisProps(odometerData.length),
									yAxis: { format: (v: number) => v.toLocaleString() }
								}}
							>
								{#snippet tooltip()}
									<Chart.Tooltip hideLabel />
								{/snippet}
							</AreaChart>
						</Chart.Container>
					</div>
					<div
						class="mt-3 flex flex-wrap items-center justify-center gap-4 text-sm"
						role="list"
						aria-label="Odometer legend"
					>
						{#each odometerSeries as s (s.key)}
							<div class="flex items-center gap-2" role="listitem">
								<div
									class="h-3 w-3 rounded-sm"
									style="background-color: {s.color}"
									aria-hidden="true"
								></div>
								<span class="text-muted-foreground">{s.label}</span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-sm text-muted-foreground text-center py-8">No odometer data available</p>
				{/if}
			</Card.Content>
		</Card.Root>

		<!-- 5. Cost per Mile -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Cost per Mile</Card.Title>
				<Card.Description>Cost per mile trend by vehicle</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if costPerMileData.length > 0}
					<div use:animateOnView={'chart-line-animated'}>
						<Chart.Container config={costPerMileConfig} class="h-[300px] w-full">
							<LineChart
								data={costPerMileData}
								x="date"
								y={cpmVehicleNames}
								series={costPerMileSeries}
								padding={CHART_PADDING}
								props={{
									...TREND_LINE_PROPS,
									xAxis: monthlyXAxisProps(costPerMileData.length),
									yAxis: { format: formatCentsAxis }
								}}
							>
								{#snippet tooltip()}
									<Chart.Tooltip hideLabel />
								{/snippet}
							</LineChart>
						</Chart.Container>
					</div>
					<div
						class="mt-3 flex flex-wrap items-center justify-center gap-4 text-sm"
						role="list"
						aria-label="Cost per mile legend"
					>
						{#each costPerMileSeries as s (s.key)}
							<div class="flex items-center gap-2" role="listitem">
								<div
									class="h-3 w-3 rounded-sm"
									style="background-color: {s.color}"
									aria-hidden="true"
								></div>
								<span class="text-muted-foreground">{s.label}</span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-sm text-muted-foreground text-center py-8">
						No cost per mile data available
					</p>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>
</div>
