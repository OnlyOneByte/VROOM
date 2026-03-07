<script lang="ts">
	import '$lib/components/charts/pie-chart-animations.css';
	import '$lib/components/charts/bar-chart-animations.css';
	import { animateOnView } from '$lib/utils/animate-on-view';
	import { createVisibilityWatch } from '$lib/utils/visibility-watch.svelte';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { BarChart, PieChart } from 'layerchart';
	import {
		LoaderCircle,
		CircleAlert,
		TrendingUp,
		CreditCard,
		Shield,
		DollarSign
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Chart from '$lib/components/ui/chart';
	import { Badge } from '$lib/components/ui/badge';
	import { analyticsApi, getDefaultDateRange } from '$lib/services/analytics-api';
	import ExpenseTrendChart from '$lib/components/charts/ExpenseTrendChart.svelte';
	import { AppLineChart, AppBarChart, AppPieChart, StatCardGrid } from '$lib/components/charts';
	import { CHART_COLORS, buildChartConfig, buildCategoryPieData } from '$lib/utils/chart-colors';
	import type { CrossVehicleResponse, FinancingResponse, InsuranceResponse } from '$lib/types';
	import { formatCurrency } from '$lib/utils/formatters';
	import { formatCurrencyAxis, parseMonthToDate } from '$lib/utils/chart-formatters';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { getFuelEfficiencyLabel, getDistanceUnitLabel } from '$lib/utils/units';

	let crossVehicle = $state<CrossVehicleResponse | null>(null);
	let financing = $state<FinancingResponse | null>(null);
	let insurance = $state<InsuranceResponse | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	// Visibility-gated rendering for inline charts that bypass ChartCard.
	// Charts in hidden tabs (bits-ui `hidden` attr → display:none) mount into
	// 0×0 containers, causing LayerChart negative-dimension warnings.
	// Uses synchronous MutationObserver + offsetParent check instead of async IO.
	let costBarGate = createVisibilityWatch();
	let typeDistGate = createVisibilityWatch();

	// Dynamic unit labels — cross-vehicle view uses global unit preferences
	let units = $derived(crossVehicle?.units ?? settingsStore.unitPreferences);
	let efficiencyLabel = $derived(getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit));
	let distShortLabel = $derived(getDistanceUnitLabel(units.distanceUnit, true));

	async function loadData() {
		try {
			isLoading = true;
			error = null;
			const [cv, fin, ins] = await Promise.all([
				analyticsApi.getCrossVehicle(getDefaultDateRange()),
				analyticsApi.getFinancing(),
				analyticsApi.getInsurance()
			]);
			crossVehicle = cv;
			financing = fin;
			insurance = ins;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load cross-vehicle data';
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		loadData();
	});

	// --- Section 1: Monthly Expense Trends ---
	let trendData = $derived(
		(crossVehicle?.monthlyExpenseTrends ?? []).map(d => ({
			...d,
			date: parseMonthToDate(d.month)
		}))
	);

	// --- Section 2: Expense Breakdown Pie ---
	let appPieData = $derived(buildCategoryPieData(crossVehicle?.expenseByCategory ?? []));

	// --- Section 3: Vehicle Cost Comparison Bar ---
	let costBarData = $derived(crossVehicle?.vehicleCostComparison ?? []);

	const costBarConfig: Chart.ChartConfig = {
		totalCost: { label: 'Total Cost', color: 'var(--chart-1)' }
	};

	const costBarSeries = [{ key: 'totalCost', label: 'Total Cost', color: 'var(--chart-1)' }];

	// --- Section 3b: Fuel Efficiency Comparison ---
	let fuelEffVehicleNames = $derived.by(() => {
		const names = new SvelteSet<string>();
		for (const month of crossVehicle?.fuelEfficiencyComparison ?? []) {
			for (const v of month.vehicles) {
				names.add(v.vehicleName);
			}
		}
		return [...names];
	});

	let fuelEffData = $derived.by(() => {
		return (crossVehicle?.fuelEfficiencyComparison ?? []).map(d => {
			const row: Record<string, number | string | Date> = {
				month: d.month,
				date: parseMonthToDate(d.month)
			};
			for (const v of d.vehicles) {
				row[v.vehicleName] = v.efficiency;
			}
			return row;
		});
	});

	let fuelEffSeries = $derived(
		fuelEffVehicleNames.map((name, i) => ({
			key: name,
			label: name,
			color: CHART_COLORS[i % CHART_COLORS.length] ?? 'var(--chart-1)'
		}))
	);

	let fuelEffConfig = $derived(buildChartConfig(fuelEffSeries));

	// --- Section 4: Financing ---
	let loanBreakdownData = $derived(
		(financing?.loanBreakdown ?? []).map(d => ({ ...d, date: parseMonthToDate(d.month) }))
	);
	let hasLoanBreakdown = $derived(loanBreakdownData.length > 0);

	const loanChartConfig: Chart.ChartConfig = {
		principal: { label: 'Principal', color: 'var(--chart-2)' },
		interest: { label: 'Interest', color: 'var(--chart-3)' }
	};

	const loanSeries = [
		{ key: 'principal', label: 'Principal', color: 'var(--chart-2)' },
		{ key: 'interest', label: 'Interest', color: 'var(--chart-3)' }
	];

	let typeDistData = $derived(
		(financing?.typeDistribution ?? []).map(d => ({
			...d,
			color:
				d.type === 'loan'
					? 'var(--chart-1)'
					: d.type === 'lease'
						? 'var(--chart-3)'
						: 'var(--chart-2)'
		}))
	);

	let typeDistConfig = $derived.by(() => {
		const config: Chart.ChartConfig = {};
		for (const item of typeDistData) {
			config[item.type] = { label: item.type, color: item.color };
		}
		return config;
	});

	function getFinancingBadgeVariant(
		type: string
	): 'default' | 'secondary' | 'outline' | 'destructive' {
		if (type === 'loan') return 'default';
		if (type === 'lease') return 'secondary';
		return 'outline';
	}

	// Financing summary stat card items
	let financingSummaryItems = $derived.by(() => {
		if (!financing) return [];
		const s = financing.summary;
		return [
			{
				label: 'Total Monthly Payments',
				value: formatCurrency(s.totalMonthlyPayments),
				subtitle: '/month'
			},
			{
				label: 'Remaining Balance',
				value: formatCurrency(s.remainingBalance),
				subtitle: 'across all vehicles'
			},
			{
				label: 'Interest Paid YTD',
				value: formatCurrency(s.interestPaidYtd),
				subtitle: 'on loans'
			},
			{
				label: 'Active Financing',
				value: String(s.activeCount),
				subtitle: `${s.loanCount} loan${s.loanCount !== 1 ? 's' : ''}, ${s.leaseCount} lease${s.leaseCount !== 1 ? 's' : ''}`
			}
		];
	});

	// --- Section 5: Insurance ---
	let premiumTrendData = $derived(
		(insurance?.monthlyPremiumTrend ?? []).map(d => ({ ...d, date: parseMonthToDate(d.month) }))
	);

	const premiumChartConfig: Chart.ChartConfig = {
		premiums: { label: 'Premiums', color: 'var(--chart-4)' }
	};

	const premiumSeries = [{ key: 'premiums', label: 'Premiums', color: 'var(--chart-4)' }];

	let carrierData = $derived(insurance?.costByCarrier ?? []);

	const carrierChartConfig: Chart.ChartConfig = {
		annualPremium: { label: 'Annual Premium', color: 'var(--chart-4)' }
	};

	const carrierSeries = [
		{ key: 'annualPremium', label: 'Annual Premium', color: 'var(--chart-4)' }
	];

	// Insurance summary stat card items
	let insuranceSummaryItems = $derived.by(() => {
		if (!insurance) return [];
		const s = insurance.summary;
		return [
			{
				label: 'Total Monthly Premiums',
				value: formatCurrency(s.totalMonthlyPremiums),
				subtitle: '/month'
			},
			{
				label: 'Total Annual Premiums',
				value: formatCurrency(s.totalAnnualPremiums),
				subtitle: '/year'
			},
			{
				label: 'Active Policies',
				value: String(s.activePoliciesCount),
				subtitle: 'vehicles insured'
			}
		];
	});

	// Insurance cost analysis
	let avgCostPerVehicle = $derived.by(() => {
		if (!insurance || insurance.vehicleDetails.length === 0) return 0;
		return insurance.summary.totalMonthlyPremiums / insurance.vehicleDetails.length;
	});

	let mostExpensiveVehicle = $derived.by(() => {
		if (!insurance || insurance.vehicleDetails.length === 0) return null;
		return insurance.vehicleDetails.reduce((max, v) =>
			v.monthlyPremium > max.monthlyPremium ? v : max
		);
	});
</script>

{#if isLoading}
	<div class="flex justify-center p-12">
		<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
	</div>
{:else if error}
	<div class="rounded-lg border bg-card p-6">
		<div class="flex items-center gap-3 text-destructive mb-4">
			<CircleAlert class="h-5 w-5" />
			<p class="font-medium">Failed to load cross-vehicle analytics</p>
		</div>
		<p class="text-sm text-muted-foreground mb-4">{error}</p>
		<Button onclick={loadData}>Retry</Button>
	</div>
{:else if crossVehicle && financing && insurance}
	<div class="space-y-4 md:space-y-6">
		<!-- Section 1: Monthly Expense Trends -->
		{#if trendData.length > 0}
			<ExpenseTrendChart data={trendData} title="Monthly Expense Trends">
				{#snippet icon()}
					<TrendingUp class="h-5 w-5 text-primary" />
				{/snippet}
			</ExpenseTrendChart>
		{/if}

		<!-- Section 2: Expense by Category + Vehicle Cost Comparison (2-col grid) -->
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
			<!-- Expense by Category (migrated to AppPieChart) -->
			{#if appPieData.length > 0}
				<AppPieChart
					title="Expense by Category"
					description="Distribution across all vehicles"
					data={appPieData}
				/>
			{/if}

			<!-- Vehicle Cost Comparison (kept manual — has cost-per-mile list) -->
			{#if costBarData.length > 0}
				<Card.Root class="p-4 sm:p-6">
					<div class="space-y-4">
						<div>
							<h3 class="font-semibold text-sm sm:text-base">Vehicle Cost Comparison</h3>
							<p class="text-xs sm:text-sm text-muted-foreground">Total costs by vehicle</p>
						</div>
						<div class="chart-bar-animate-ready" use:animateOnView={'chart-bar-animated'}>
							<div bind:this={costBarGate.el} style="min-height: 250px">
								{#if costBarGate.visible}
									<Chart.Container config={costBarConfig} class="h-[250px] sm:h-[300px] w-full">
										<BarChart
											data={costBarData}
											x="vehicleName"
											y="totalCost"
											series={costBarSeries}
											padding={{ top: 4, left: 48, bottom: 40, right: 4 }}
											props={{
												bars: { stroke: 'none' },
												xAxis: {
													ticks: costBarData.map(d => d.vehicleName),
													format: (v: string) => {
														if (typeof v !== 'string') return '';
														return v.length > 20 ? v.slice(0, 18) + '…' : v;
													}
												},
												yAxis: { format: formatCurrencyAxis }
											}}
										>
											{#snippet tooltip()}
												<Chart.Tooltip hideLabel />
											{/snippet}
										</BarChart>
									</Chart.Container>
								{/if}
							</div>
						</div>
						<div class="space-y-2 pt-4 border-t border-border">
							{#each costBarData as vehicle (vehicle.vehicleId)}
								<div class="flex items-center justify-between text-sm">
									<span>{vehicle.vehicleName}</span>
									<span class="font-semibold">
										{vehicle.costPerDistance != null
											? `${formatCurrency(vehicle.costPerDistance)}/${distShortLabel}`
											: 'N/A'}
									</span>
								</div>
							{/each}
						</div>
					</div>
				</Card.Root>
			{/if}
		</div>

		<!-- Section 3: Fuel Efficiency Comparison (migrated to AppLineChart) -->
		{#if fuelEffData.length > 0}
			<AppLineChart
				title="Fuel Efficiency Comparison"
				description="{efficiencyLabel} trends across all vehicles"
				data={fuelEffData}
				x="date"
				y={fuelEffVehicleNames}
				series={fuelEffSeries}
				config={fuelEffConfig}
				yAxisFormat={v => `${v.toFixed(0)} ${efficiencyLabel}`}
			/>
		{/if}

		<!-- Section 4: Financing Overview -->
		<div class="flex items-center gap-2">
			<CreditCard class="h-5 w-5 text-muted-foreground" />
			<h2 class="text-xl font-bold">Financing Overview</h2>
		</div>

		<!-- Financing Summary Cards (migrated to StatCardGrid) -->
		<StatCardGrid items={financingSummaryItems} columns={4} />

		<!-- Vehicle Financing Details (kept manual — card list) -->
		{#if financing.vehicleDetails.length > 0}
			<Card.Root class="p-4 sm:p-6">
				<div class="space-y-4">
					<h3 class="font-semibold text-sm sm:text-base">Vehicle Financing Details</h3>
					<div class="space-y-3">
						{#each financing.vehicleDetails as vehicle (vehicle.vehicleId)}
							<div class="p-3 sm:p-4 rounded-lg border border-border">
								<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
									<div class="space-y-2">
										<div class="flex items-center gap-2">
											<h4 class="font-semibold text-sm sm:text-base">
												{vehicle.vehicleName}
											</h4>
											<Badge variant={getFinancingBadgeVariant(vehicle.financingType)}>
												{vehicle.financingType === 'own'
													? 'Owned'
													: vehicle.financingType.charAt(0).toUpperCase() +
														vehicle.financingType.slice(1)}
											</Badge>
										</div>

										{#if vehicle.financingType !== 'own'}
											<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs sm:text-sm">
												<div>
													<p class="text-muted-foreground">Monthly</p>
													<p class="font-semibold">
														{formatCurrency(vehicle.monthlyPayment)}
													</p>
												</div>
												<div>
													<p class="text-muted-foreground">Remaining</p>
													<p class="font-semibold">
														{formatCurrency(vehicle.remainingBalance)}
													</p>
												</div>
												{#if vehicle.financingType === 'loan'}
													<div>
														<p class="text-muted-foreground">APR</p>
														<p class="font-semibold">
															{vehicle.apr != null ? `${vehicle.apr.toFixed(1)}%` : '—'}
														</p>
													</div>
													<div>
														<p class="text-muted-foreground">Interest Paid</p>
														<p class="font-semibold text-destructive">
															{formatCurrency(vehicle.interestPaid)}
														</p>
													</div>
												{/if}
											</div>
										{:else}
											<p class="text-xs sm:text-sm text-muted-foreground">
												Owned outright - No financing
											</p>
										{/if}
									</div>

									{#if vehicle.financingType !== 'own'}
										<div class="text-left sm:text-right">
											<p class="text-xs text-muted-foreground">Months Remaining</p>
											<p class="text-xl sm:text-2xl font-bold">
												{vehicle.monthsRemaining}
											</p>
										</div>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</div>
			</Card.Root>
		{/if}

		<!-- Financing Charts: 2-col grid -->
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
			<!-- Loan Payment Breakdown (migrated to AppBarChart) -->
			{#if hasLoanBreakdown}
				<AppBarChart
					title="Loan Payment Breakdown"
					description="Interest vs Principal over time"
					data={loanBreakdownData}
					x="date"
					y={['principal', 'interest']}
					series={loanSeries}
					config={loanChartConfig}
				/>
			{/if}

			<!-- Financing Type Distribution (kept manual — legend shows vehicle count) -->
			{#if typeDistData.length > 0}
				<Card.Root class="p-4 sm:p-6">
					<div class="space-y-4">
						<div>
							<h3 class="font-semibold text-sm sm:text-base">Financing Type Distribution</h3>
							<p class="text-xs sm:text-sm text-muted-foreground">Value by financing type</p>
						</div>
						<div
							bind:this={typeDistGate.el}
							class="chart-pie-animate-ready chart-pie-animated mx-auto aspect-square max-h-[250px] w-full max-w-[250px] overflow-hidden"
						>
							{#if typeDistGate.visible}
								<Chart.Container
									config={typeDistConfig}
									class="aspect-square h-full w-full overflow-hidden"
								>
									<PieChart
										data={typeDistData}
										key="type"
										value="value"
										label="type"
										cRange={typeDistData.map(d => d.color)}
										innerRadius={0.5}
										padAngle={0.02}
										cornerRadius={4}
										props={{
											pie: {}
										}}
									>
										{#snippet tooltip()}
											<Chart.Tooltip hideLabel />
										{/snippet}
									</PieChart>
								</Chart.Container>
							{/if}
						</div>
						<div class="space-y-1.5" role="list" aria-label="Financing types">
							{#each typeDistData as item (item.type)}
								<div class="flex items-center justify-between p-2 rounded-lg" role="listitem">
									<div class="flex items-center gap-2">
										<div
											class="w-3 h-3 rounded-full"
											style:background-color={item.color}
											aria-hidden="true"
										></div>
										<span class="text-sm font-medium capitalize">{item.type}</span>
									</div>
									<div class="text-right">
										<div class="text-sm font-bold">
											{item.count} vehicle{item.count !== 1 ? 's' : ''}
										</div>
									</div>
								</div>
							{/each}
						</div>
					</div>
				</Card.Root>
			{/if}
		</div>

		<!-- Section 5: Insurance Overview -->
		<div class="flex items-center gap-2 mt-4">
			<Shield class="h-5 w-5 text-muted-foreground" />
			<h2 class="text-xl font-bold">Insurance Overview</h2>
		</div>

		<!-- Insurance Summary Cards (migrated to StatCardGrid) -->
		<StatCardGrid items={insuranceSummaryItems} columns={3} />

		<!-- Insurance Coverage Details (kept manual — card list) -->
		{#if insurance.vehicleDetails.length > 0}
			<Card.Root class="p-4 sm:p-6">
				<div class="space-y-4">
					<h3 class="font-semibold text-sm sm:text-base">Insurance Coverage Details</h3>
					<div class="space-y-3">
						{#each insurance.vehicleDetails as vehicle (vehicle.vehicleId)}
							<div class="p-3 sm:p-4 rounded-lg border border-border">
								<div class="flex-1 space-y-2">
									<div class="flex flex-col sm:flex-row sm:items-center gap-2">
										<h4 class="font-semibold text-sm sm:text-base">
											{vehicle.vehicleName}
										</h4>
										<Badge variant="outline">{vehicle.carrier}</Badge>
									</div>
									<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs sm:text-sm">
										<div>
											<p class="text-muted-foreground">Monthly</p>
											<p class="font-semibold">
												{formatCurrency(vehicle.monthlyPremium)}
											</p>
										</div>
										<div>
											<p class="text-muted-foreground">Annual</p>
											<p class="font-semibold">
												{formatCurrency(vehicle.annualPremium)}
											</p>
										</div>
										<div>
											<p class="text-muted-foreground">Deductible</p>
											<p class="font-semibold">
												{vehicle.deductible != null ? formatCurrency(vehicle.deductible) : '—'}
											</p>
										</div>
										<div>
											<p class="text-muted-foreground">Coverage</p>
											<p class="font-semibold">{vehicle.coverageType ?? '—'}</p>
										</div>
									</div>
								</div>
							</div>
						{/each}
					</div>
				</div>
			</Card.Root>
		{/if}

		<!-- Insurance Charts: 2-col grid -->
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
			<!-- Monthly Premium Trends (migrated to AppLineChart) -->
			{#if premiumTrendData.length > 0}
				<AppLineChart
					title="Monthly Premium Trends"
					description="Total insurance costs over time"
					data={premiumTrendData}
					x="date"
					y="premiums"
					series={premiumSeries}
					config={premiumChartConfig}
				/>
			{/if}

			<!-- Cost by Carrier (migrated to AppBarChart) -->
			{#if carrierData.length > 0}
				<AppBarChart
					title="Cost by Insurance Carrier"
					description="Annual premium comparison"
					data={carrierData}
					x="carrier"
					y="annualPremium"
					series={carrierSeries}
					config={carrierChartConfig}
					xAxisProps={{
						ticks: carrierData.map(d => d.carrier),
						format: (v: string) => (typeof v === 'string' ? v : String(v))
					}}
				/>
			{/if}
		</div>

		<!-- Insurance Cost Analysis (kept manual — custom colored backgrounds) -->
		<Card.Root class="p-4 sm:p-6 border-chart-4/30">
			<div class="space-y-3">
				<div class="flex items-center gap-2">
					<DollarSign class="h-4 w-4 sm:h-5 sm:w-5 text-chart-4" />
					<h3 class="font-semibold text-sm sm:text-base">Insurance Cost Analysis</h3>
				</div>
				<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
					<div class="p-3 sm:p-4 bg-chart-4/10 rounded-lg">
						<p class="text-xs sm:text-sm text-muted-foreground">Cost per Vehicle/Month</p>
						<p class="text-lg sm:text-xl font-bold mt-1">
							{formatCurrency(avgCostPerVehicle)}
						</p>
						<p class="text-xs text-muted-foreground mt-1">average across fleet</p>
					</div>
					<div class="p-3 sm:p-4 bg-chart-4/10 rounded-lg">
						<p class="text-xs sm:text-sm text-muted-foreground">Annual Total</p>
						<p class="text-lg sm:text-xl font-bold mt-1">
							{formatCurrency(insurance.summary.totalAnnualPremiums)}
						</p>
						<p class="text-xs text-muted-foreground mt-1">all policies combined</p>
					</div>
					<div class="p-3 sm:p-4 bg-chart-4/10 rounded-lg">
						<p class="text-xs sm:text-sm text-muted-foreground">Most Expensive</p>
						<p class="text-lg sm:text-xl font-bold mt-1">
							{mostExpensiveVehicle
								? `${formatCurrency(mostExpensiveVehicle.monthlyPremium)}/mo`
								: '—'}
						</p>
						<p class="text-xs text-muted-foreground mt-1">
							{mostExpensiveVehicle?.vehicleName ?? '—'}
						</p>
					</div>
				</div>
			</div>
		</Card.Root>
	</div>
{/if}
