<script lang="ts">
	import '$lib/components/analytics/pie-chart-animations.css';
	import '$lib/components/analytics/line-chart-animations.css';
	import '$lib/components/analytics/bar-chart-animations.css';
	import { animateOnView } from '$lib/utils/animate-on-view';
	import { onMount } from 'svelte';
	import { AreaChart, BarChart, LineChart, PieChart } from 'layerchart';
	import { LoaderCircle, CircleAlert } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Chart from '$lib/components/ui/chart';
	import * as Select from '$lib/components/ui/select';
	import { Progress } from '$lib/components/ui/progress';
	import { analyticsApi, getDefaultDateRange } from '$lib/services/analytics-api';
	import { vehicleApi } from '$lib/services/vehicle-api';
	import type {
		Vehicle,
		VehicleHealthResponse,
		VehicleTCOResponse,
		VehicleExpensesResponse
	} from '$lib/types';
	import { formatCurrency, formatNumber } from '$lib/utils/formatters';
	import {
		formatCurrencyAxis,
		CHART_PADDING,
		TREND_LINE_PROPS,
		monthlyXAxisProps
	} from '$lib/utils/chart-formatters';

	function parseMonthToDate(month: string): Date {
		const [y, m] = month.split('-');
		return new Date(Number(y), Number(m) - 1, 1);
	}

	const categoryColors: Record<string, string> = {
		fuel: 'var(--chart-1)',
		maintenance: 'var(--chart-2)',
		financial: 'var(--chart-3)',
		regulatory: 'var(--chart-4)',
		enhancement: 'var(--chart-5)',
		misc: 'var(--primary)'
	};

	const categoryLabels: Record<string, string> = {
		fuel: 'Fuel',
		maintenance: 'Maintenance',
		financial: 'Financial',
		regulatory: 'Regulatory',
		enhancement: 'Enhancement',
		misc: 'Misc'
	};

	let vehicles = $state<Vehicle[]>([]);
	let selectedVehicleId = $state<string>('');
	let health = $state<VehicleHealthResponse | null>(null);
	let tco = $state<VehicleTCOResponse | null>(null);
	let expenses = $state<VehicleExpensesResponse | null>(null);
	let isLoadingVehicles = $state(true);
	let isLoadingData = $state(false);
	let error = $state<string | null>(null);

	async function loadVehicles() {
		try {
			isLoadingVehicles = true;
			vehicles = await vehicleApi.getVehicles();
			if (vehicles.length === 1) {
				selectedVehicleId = vehicles[0]!.id;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load vehicles';
		} finally {
			isLoadingVehicles = false;
		}
	}

	async function loadVehicleData(vehicleId: string) {
		try {
			isLoadingData = true;
			error = null;
			const [healthData, tcoData, expensesData] = await Promise.all([
				analyticsApi.getVehicleHealth(vehicleId),
				analyticsApi.getVehicleTCO(vehicleId),
				analyticsApi.getVehicleExpenses(vehicleId, getDefaultDateRange())
			]);
			health = healthData;
			tco = tcoData;
			expenses = expensesData;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load vehicle data';
		} finally {
			isLoadingData = false;
		}
	}

	function handleVehicleChange(value: string | undefined) {
		if (value) {
			selectedVehicleId = value;
		}
	}

	onMount(() => {
		loadVehicles();
	});

	let shouldLoadData = $derived(selectedVehicleId && !isLoadingVehicles);

	$effect(() => {
		if (shouldLoadData && selectedVehicleId) {
			loadVehicleData(selectedVehicleId);
		}
	});

	let selectedVehicle = $derived(vehicles.find(v => v.id === selectedVehicleId));

	// --- Health Score ---
	function getScoreColor(score: number): string {
		if (score >= 70) return 'text-chart-2';
		if (score >= 40) return 'text-chart-5';
		return 'text-destructive';
	}

	function getScoreBgColor(score: number): string {
		if (score >= 70) return 'bg-chart-2/10';
		if (score >= 40) return 'bg-chart-5/10';
		return 'bg-destructive/10';
	}

	// --- TCO Breakdown Pie ---
	let tcoBreakdownData = $derived.by(() => {
		if (!tco) return [];
		const items = [
			{ category: 'Fuel', amount: tco.fuelCost, color: 'var(--chart-1)' },
			{ category: 'Maintenance', amount: tco.maintenanceCost, color: 'var(--chart-2)' },
			{ category: 'Insurance', amount: tco.insuranceCost, color: 'var(--chart-3)' },
			{ category: 'Financing', amount: tco.financingInterest, color: 'var(--chart-4)' },
			{ category: 'Other', amount: tco.otherCosts, color: 'var(--chart-5)' }
		];
		return items.filter(i => i.amount > 0);
	});

	let tcoBreakdownTotal = $derived(tcoBreakdownData.reduce((sum, d) => sum + d.amount, 0));

	let tcoBreakdownConfig = $derived.by(() => {
		const config: Chart.ChartConfig = {};
		for (const item of tcoBreakdownData) {
			config[item.category] = { label: item.category, color: item.color };
		}
		return config;
	});

	// --- TCO Monthly Trend (stacked area) ---
	let tcoTrendData = $derived(
		(tco?.monthlyTrend ?? []).map(d => ({ ...d, date: parseMonthToDate(d.month) }))
	);

	const tcoTrendConfig: Chart.ChartConfig = {
		fuel: { label: 'Fuel', color: 'var(--chart-1)' },
		maintenance: { label: 'Maintenance', color: 'var(--chart-2)' },
		insurance: { label: 'Insurance', color: 'var(--chart-3)' },
		financing: { label: 'Financing', color: 'var(--chart-4)' }
	};

	const tcoTrendSeries = [
		{ key: 'fuel', label: 'Fuel', color: 'var(--chart-1)' },
		{ key: 'maintenance', label: 'Maintenance', color: 'var(--chart-2)' },
		{ key: 'insurance', label: 'Insurance', color: 'var(--chart-3)' },
		{ key: 'financing', label: 'Financing', color: 'var(--chart-4)' }
	];

	// --- Maintenance Costs Bar ---
	let maintenanceData = $derived(
		(expenses?.maintenanceCosts ?? []).map(d => ({ ...d, date: parseMonthToDate(d.month) }))
	);

	const maintenanceConfig: Chart.ChartConfig = {
		cost: { label: 'Cost', color: 'var(--chart-2)' }
	};

	const maintenanceSeries = [{ key: 'cost', label: 'Cost', color: 'var(--chart-2)' }];

	// --- Fuel Efficiency & Cost Line ---
	let fuelData = $derived(
		(expenses?.fuelEfficiencyAndCost ?? []).map(d => ({ ...d, date: parseMonthToDate(d.month) }))
	);
	let fuelDataWithMpg = $derived(fuelData.filter(d => d.mpg != null));

	const fuelConfig: Chart.ChartConfig = {
		mpg: { label: 'MPG', color: 'var(--chart-1)' },
		cost: { label: 'Cost', color: 'var(--chart-3)' }
	};

	const fuelSeries = [
		{ key: 'mpg', label: 'MPG', color: 'var(--chart-1)' },
		{ key: 'cost', label: 'Cost', color: 'var(--chart-3)' }
	];

	// --- Expense Category Breakdown Pie ---
	let expenseBreakdownData = $derived(
		(expenses?.expenseBreakdown ?? []).map(c => ({
			...c,
			color: categoryColors[c.category] ?? 'var(--primary)',
			label: categoryLabels[c.category] ?? c.category
		}))
	);

	let expenseBreakdownConfig = $derived.by(() => {
		const config: Chart.ChartConfig = {};
		for (const item of expenseBreakdownData) {
			config[item.category] = { label: item.label, color: item.color };
		}
		return config;
	});
</script>

{#if isLoadingVehicles}
	<div class="flex justify-center p-12">
		<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
	</div>
{:else if vehicles.length === 0}
	<div class="rounded-lg border bg-card p-6 text-center">
		<p class="text-muted-foreground mb-4">No vehicles found. Add a vehicle to see analytics.</p>
		<Button href="/vehicles/new">Add Vehicle</Button>
	</div>
{:else}
	<div class="space-y-6">
		<!-- Vehicle Selector -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Select Vehicle</Card.Title>
				<Card.Description>Choose a vehicle to view detailed analytics</Card.Description>
			</Card.Header>
			<Card.Content>
				<Select.Root type="single" value={selectedVehicleId} onValueChange={handleVehicleChange}>
					<Select.Trigger class="w-full">
						{#if selectedVehicle}
							{selectedVehicle.year}
							{selectedVehicle.make}
							{selectedVehicle.model}
						{:else}
							Select a vehicle
						{/if}
					</Select.Trigger>
					<Select.Content>
						{#each vehicles as vehicle (vehicle.id)}
							<Select.Item value={vehicle.id} label="{vehicle.year} {vehicle.make} {vehicle.model}">
								{vehicle.year}
								{vehicle.make}
								{vehicle.model}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Card.Content>
		</Card.Root>

		{#if isLoadingData}
			<div class="flex justify-center p-12">
				<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		{:else if error}
			<div class="rounded-lg border bg-card p-6">
				<div class="flex items-center gap-3 text-destructive mb-4">
					<CircleAlert class="h-5 w-5" />
					<p class="font-medium">Failed to load vehicle analytics</p>
				</div>
				<p class="text-sm text-muted-foreground mb-4">{error}</p>
				<Button onclick={() => selectedVehicleId && loadVehicleData(selectedVehicleId)}>
					Retry
				</Button>
			</div>
		{:else if health && tco && expenses}
			<!-- Section 1: Vehicle Health Score -->
			<Card.Root>
				<Card.Header>
					<Card.Title>Vehicle Health Score</Card.Title>
					<Card.Description>{health.vehicleName}</Card.Description>
				</Card.Header>
				<Card.Content>
					<div class="space-y-6">
						<!-- Overall Score Badge -->
						<div class="flex items-center gap-4">
							<div
								class="flex h-20 w-20 items-center justify-center rounded-full {getScoreBgColor(
									health.overallScore
								)}"
							>
								<span class="text-3xl font-bold {getScoreColor(health.overallScore)}">
									{health.overallScore}
								</span>
							</div>
							<div>
								<p class="text-sm text-muted-foreground">Overall Score</p>
								<p class="text-lg font-medium">out of 100</p>
							</div>
						</div>

						<!-- Sub-scores with Progress bars -->
						<div class="grid gap-5 md:grid-cols-3">
							<div class="space-y-2">
								<div class="flex items-center justify-between">
									<span class="text-sm font-medium">Maintenance Regularity</span>
									<span class="text-sm font-bold">{health.maintenanceRegularity}/100</span>
								</div>
								<Progress value={health.maintenanceRegularity} max={100} class="h-2" />
							</div>
							<div class="space-y-2">
								<div class="flex items-center justify-between">
									<span class="text-sm font-medium">Mileage Adherence</span>
									<span class="text-sm font-bold">{health.mileageIntervalAdherence}/100</span>
								</div>
								<Progress value={health.mileageIntervalAdherence} max={100} class="h-2" />
							</div>
							<div class="space-y-2">
								<div class="flex items-center justify-between">
									<span class="text-sm font-medium">Insurance Coverage</span>
									<span class="text-sm font-bold">{health.insuranceCoverage}/100</span>
								</div>
								<Progress value={health.insuranceCoverage} max={100} class="h-2" />
							</div>
						</div>
					</div>
				</Card.Content>
			</Card.Root>

			<!-- Section 2: TCO Dashboard -->
			<Card.Root>
				<Card.Header>
					<Card.Title>Total Cost of Ownership</Card.Title>
					<Card.Description>{tco.vehicleName}</Card.Description>
				</Card.Header>
				<Card.Content>
					<div class="space-y-6">
						<!-- Summary Cards -->
						<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
							<div class="rounded-lg border bg-card p-4">
								<p class="text-sm text-muted-foreground">Total Cost</p>
								<p class="text-xl font-bold mt-1">{formatCurrency(tco.totalCost)}</p>
							</div>
							<div class="rounded-lg border bg-card p-4">
								<p class="text-sm text-muted-foreground">Cost per Mile</p>
								<p class="text-xl font-bold mt-1">
									{tco.costPerMile != null ? formatCurrency(tco.costPerMile) : 'N/A'}
								</p>
							</div>
							<div class="rounded-lg border bg-card p-4">
								<p class="text-sm text-muted-foreground">Cost per Month</p>
								<p class="text-xl font-bold mt-1">{formatCurrency(tco.costPerMonth)}</p>
							</div>
							<div class="rounded-lg border bg-card p-4">
								<p class="text-sm text-muted-foreground">Total Miles</p>
								<p class="text-xl font-bold mt-1">{tco.totalMiles.toLocaleString()}</p>
							</div>
						</div>

						<!-- TCO Breakdown Pie Chart -->
						{#if tcoBreakdownData.length > 0}
							<div>
								<h3 class="text-sm font-semibold mb-4">Cost Breakdown</h3>
								<div class="flex flex-col md:flex-row gap-6">
									<div class="flex-1 flex items-center justify-center">
										<div
											use:animateOnView={'chart-pie-animated'}
											class="mx-auto aspect-square max-h-[250px] w-full max-w-[250px]"
										>
											<Chart.Container config={tcoBreakdownConfig} class="h-full w-full">
												<PieChart
													data={tcoBreakdownData}
													key="category"
													value="amount"
													label="name"
													cRange={tcoBreakdownData.map(d => d.color)}
													innerRadius={60}
													outerRadius={120}
													padAngle={0.02}
													cornerRadius={4}
												>
													{#snippet tooltip()}
														<Chart.Tooltip hideLabel />
													{/snippet}
												</PieChart>
											</Chart.Container>
										</div>
									</div>
									<div
										class="flex-1 space-y-1.5 min-w-0"
										role="list"
										aria-label="TCO cost breakdown"
									>
										{#each tcoBreakdownData as item (item.category)}
											<div class="flex items-center justify-between p-2 rounded-lg" role="listitem">
												<div class="flex items-center gap-2">
													<div
														class="h-3 w-3 rounded-full"
														style:background-color={item.color}
														aria-hidden="true"
													></div>
													<span class="text-sm font-medium">{item.category}</span>
												</div>
												<div class="text-right">
													<div class="text-sm font-bold">{formatCurrency(item.amount)}</div>
													<div class="text-xs text-muted-foreground">
														{tcoBreakdownTotal > 0
															? ((item.amount / tcoBreakdownTotal) * 100).toFixed(1)
															: '0'}%
													</div>
												</div>
											</div>
										{/each}
									</div>
								</div>
							</div>
						{:else}
							<p class="text-sm text-muted-foreground text-center py-4">
								No cost breakdown data available
							</p>
						{/if}

						<!-- Monthly TCO Trend (Stacked Area) -->
						{#if tcoTrendData.length > 0}
							<div>
								<h3 class="text-sm font-semibold mb-4">Monthly Cost Trend</h3>
								<div class="overflow-hidden" use:animateOnView={'chart-line-animated'}>
									<Chart.Container config={tcoTrendConfig} class="h-[300px] w-full">
										<AreaChart
											data={tcoTrendData}
											x="date"
											y={['fuel', 'maintenance', 'insurance', 'financing']}
											series={tcoTrendSeries}
											seriesLayout="stack"
											padding={CHART_PADDING}
											props={{
												xAxis: monthlyXAxisProps(tcoTrendData.length),
												yAxis: { format: formatCurrencyAxis }
											}}
										>
											{#snippet tooltip()}
												<Chart.Tooltip hideLabel />
											{/snippet}
										</AreaChart>
									</Chart.Container>
								</div>
								<div class="mt-3 flex flex-wrap justify-center gap-4">
									{#each tcoTrendSeries as s (s.key)}
										<div class="flex items-center gap-1.5">
											<div
												class="h-2.5 w-2.5 rounded-full"
												style:background-color={s.color}
												aria-hidden="true"
											></div>
											<span class="text-xs text-muted-foreground">{s.label}</span>
										</div>
									{/each}
								</div>
							</div>
						{:else}
							<p class="text-sm text-muted-foreground text-center py-4">
								No monthly trend data available
							</p>
						{/if}
					</div>
				</Card.Content>
			</Card.Root>

			<!-- Section 3: Vehicle Expense Charts -->

			<!-- Monthly Maintenance Costs -->
			<Card.Root>
				<Card.Header>
					<Card.Title>Monthly Maintenance Costs</Card.Title>
					<Card.Description>Maintenance spending over time</Card.Description>
				</Card.Header>
				<Card.Content>
					{#if maintenanceData.length > 0}
						<div use:animateOnView={'chart-bar-animated'}>
							<Chart.Container config={maintenanceConfig} class="h-[300px] w-full">
								<BarChart
									data={maintenanceData}
									x="date"
									y="cost"
									series={maintenanceSeries}
									padding={CHART_PADDING}
									props={{
										bars: { stroke: 'none' },
										xAxis: monthlyXAxisProps(maintenanceData.length),
										yAxis: { format: formatCurrencyAxis }
									}}
								>
									{#snippet tooltip()}
										<Chart.Tooltip hideLabel />
									{/snippet}
								</BarChart>
							</Chart.Container>
						</div>
					{:else}
						<p class="text-sm text-muted-foreground text-center py-8">
							No maintenance data available
						</p>
					{/if}
				</Card.Content>
			</Card.Root>

			<!-- Fuel Efficiency & Cost -->
			<Card.Root>
				<Card.Header>
					<Card.Title>Fuel Efficiency & Cost</Card.Title>
					<Card.Description>MPG and fuel cost trends</Card.Description>
				</Card.Header>
				<Card.Content>
					{#if fuelData.length > 0}
						<div use:animateOnView={'chart-line-animated'}>
							<Chart.Container config={fuelConfig} class="h-[300px] w-full">
								<LineChart
									data={fuelDataWithMpg.length > 0 ? fuelDataWithMpg : fuelData}
									x="date"
									y="mpg"
									series={fuelSeries}
									padding={CHART_PADDING}
									props={{
										...TREND_LINE_PROPS,
										xAxis: monthlyXAxisProps(fuelData.length),
										yAxis: { format: (v: number) => formatNumber(v, 1) }
									}}
								>
									{#snippet tooltip()}
										<Chart.Tooltip hideLabel />
									{/snippet}
								</LineChart>
							</Chart.Container>
						</div>
						<div class="mt-3 flex flex-wrap justify-center gap-4">
							{#each fuelSeries as s (s.key)}
								<div class="flex items-center gap-1.5">
									<div
										class="h-2.5 w-2.5 rounded-full"
										style:background-color={s.color}
										aria-hidden="true"
									></div>
									<span class="text-xs text-muted-foreground">{s.label}</span>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground text-center py-8">No fuel data available</p>
					{/if}
				</Card.Content>
			</Card.Root>

			<!-- Expense Category Breakdown -->
			<Card.Root>
				<Card.Header>
					<Card.Title>Expense Breakdown</Card.Title>
					<Card.Description>Category distribution</Card.Description>
				</Card.Header>
				<Card.Content>
					{#if expenseBreakdownData.length > 0}
						<div class="flex flex-col md:flex-row gap-6">
							<div class="flex-1 flex items-center justify-center">
								<div
									use:animateOnView={'chart-pie-animated'}
									class="mx-auto aspect-square max-h-[250px] w-full max-w-[250px]"
								>
									<Chart.Container config={expenseBreakdownConfig} class="h-full w-full">
										<PieChart
											data={expenseBreakdownData}
											key="category"
											value="amount"
											label="name"
											cRange={expenseBreakdownData.map(d => d.color)}
											innerRadius={60}
											outerRadius={120}
											padAngle={0.02}
											cornerRadius={4}
										>
											{#snippet tooltip()}
												<Chart.Tooltip hideLabel />
											{/snippet}
										</PieChart>
									</Chart.Container>
								</div>
							</div>
							<div class="flex-1 space-y-1.5 min-w-0" role="list" aria-label="Expense categories">
								{#each expenseBreakdownData as item (item.category)}
									<div class="flex items-center justify-between p-2 rounded-lg" role="listitem">
										<div class="flex items-center gap-2">
											<div
												class="h-3 w-3 rounded-full"
												style:background-color={item.color}
												aria-hidden="true"
											></div>
											<span class="text-sm font-medium">{item.label}</span>
										</div>
										<div class="text-sm font-bold">{formatCurrency(item.amount)}</div>
									</div>
								{/each}
							</div>
						</div>
					{:else}
						<p class="text-sm text-muted-foreground text-center py-8">No expense data available</p>
					{/if}
				</Card.Content>
			</Card.Root>
		{/if}
	</div>
{/if}
