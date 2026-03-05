<script lang="ts">
	import '$lib/components/analytics/pie-chart-animations.css';
	import '$lib/components/analytics/line-chart-animations.css';
	import '$lib/components/analytics/bar-chart-animations.css';
	import { animateOnView } from '$lib/utils/animate-on-view';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { BarChart, LineChart, PieChart } from 'layerchart';
	import {
		LoaderCircle,
		CircleAlert,
		TrendingUp,
		CreditCard,
		Shield,
		DollarSign
	} from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Chart from '$lib/components/ui/chart';
	import { Badge } from '$lib/components/ui/badge';
	import { analyticsApi, getDefaultDateRange } from '$lib/services/analytics-api';
	import ExpenseTrendChart from '$lib/components/charts/ExpenseTrendChart.svelte';
	import type { CrossVehicleResponse, FinancingResponse, InsuranceResponse } from '$lib/types';
	import { formatCurrency } from '$lib/utils/formatters';
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

	let crossVehicle = $state<CrossVehicleResponse | null>(null);
	let financing = $state<FinancingResponse | null>(null);
	let insurance = $state<InsuranceResponse | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

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
	let pieData = $derived(
		(crossVehicle?.expenseByCategory ?? []).map(c => ({
			...c,
			color: categoryColors[c.category] ?? 'var(--primary)',
			label: categoryLabels[c.category] ?? c.category
		}))
	);

	let pieChartConfig = $derived.by(() => {
		const config: Chart.ChartConfig = {};
		for (const item of pieData) {
			config[item.category] = { label: item.label, color: item.color };
		}
		return config;
	});

	// --- Section 3: Vehicle Cost Comparison Bar ---
	let costBarData = $derived(crossVehicle?.vehicleCostComparison ?? []);

	const costBarConfig: Chart.ChartConfig = {
		totalCost: { label: 'Total Cost', color: 'var(--chart-1)' }
	};

	const costBarSeries = [{ key: 'totalCost', label: 'Total Cost', color: 'var(--chart-1)' }];

	// --- Section 3b: Fuel Efficiency Comparison ---
	const CHART_COLORS = [
		'var(--chart-1)',
		'var(--chart-2)',
		'var(--chart-3)',
		'var(--chart-4)',
		'var(--chart-5)'
	] as const;

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
				row[v.vehicleName] = v.mpg;
			}
			return row;
		});
	});

	let fuelEffSeries = $derived(
		fuelEffVehicleNames.map((name, i) => ({
			key: name,
			label: name,
			color: CHART_COLORS[i % CHART_COLORS.length]
		}))
	);

	let fuelEffConfig = $derived.by(() => {
		const config: Chart.ChartConfig = {};
		for (const s of fuelEffSeries) {
			config[s.key] = { label: s.label, color: s.color };
		}
		return config;
	});

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
			<!-- Expense by Category -->
			{#if pieData.length > 0}
				<Card.Root class="p-4 sm:p-6">
					<div class="space-y-4">
						<div>
							<h3 class="font-semibold text-sm sm:text-base">Expense by Category</h3>
							<p class="text-xs sm:text-sm text-muted-foreground">
								Distribution across all vehicles
							</p>
						</div>
						<div
							use:animateOnView={'chart-pie-animated'}
							class="mx-auto aspect-square max-h-[250px] w-full max-w-[250px]"
						>
							<Chart.Container config={pieChartConfig} class="h-full w-full">
								<PieChart
									data={pieData}
									key="category"
									value="amount"
									label="name"
									cRange={pieData.map(d => d.color)}
									innerRadius={60}
									outerRadius={100}
									padAngle={0.02}
									cornerRadius={4}
								>
									{#snippet tooltip()}
										<Chart.Tooltip hideLabel />
									{/snippet}
								</PieChart>
							</Chart.Container>
						</div>
						<div class="space-y-2" role="list" aria-label="Expense categories">
							{#each pieData as category (category.category)}
								<div class="flex items-center justify-between" role="listitem">
									<div class="flex items-center gap-2">
										<div
											class="w-3 h-3 rounded-full"
											style:background-color={category.color}
											aria-hidden="true"
										></div>
										<span class="text-sm">{category.label}</span>
									</div>
									<div class="text-right">
										<p class="font-semibold">{formatCurrency(category.amount)}</p>
										<p class="text-xs text-muted-foreground">
											{category.percentage.toFixed(1)}%
										</p>
									</div>
								</div>
							{/each}
						</div>
					</div>
				</Card.Root>
			{/if}

			<!-- Vehicle Cost Comparison -->
			{#if costBarData.length > 0}
				<Card.Root class="p-4 sm:p-6">
					<div class="space-y-4">
						<div>
							<h3 class="font-semibold text-sm sm:text-base">Vehicle Cost Comparison</h3>
							<p class="text-xs sm:text-sm text-muted-foreground">Total costs by vehicle</p>
						</div>
						<div use:animateOnView={'chart-bar-animated'}>
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
											ticks: costBarData.length,
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
						</div>
						<div class="space-y-2 pt-4 border-t border-border">
							{#each costBarData as vehicle (vehicle.vehicleId)}
								<div class="flex items-center justify-between text-sm">
									<span>{vehicle.vehicleName}</span>
									<span class="font-semibold">
										{vehicle.costPerMile != null
											? `${formatCurrency(vehicle.costPerMile)}/mi`
											: 'N/A'}
									</span>
								</div>
							{/each}
						</div>
					</div>
				</Card.Root>
			{/if}
		</div>

		<!-- Section 3: Fuel Efficiency Comparison -->
		{#if fuelEffData.length > 0}
			<Card.Root class="p-4 sm:p-6">
				<div class="space-y-4">
					<div>
						<h3 class="font-semibold text-sm sm:text-base">Fuel Efficiency Comparison</h3>
						<p class="text-xs sm:text-sm text-muted-foreground">MPG trends across all vehicles</p>
					</div>
					<div use:animateOnView={'chart-line-animated'}>
						<Chart.Container config={fuelEffConfig} class="h-[250px] sm:h-[300px] w-full">
							<LineChart
								data={fuelEffData}
								x="date"
								y={fuelEffVehicleNames}
								series={fuelEffSeries}
								padding={CHART_PADDING}
								props={{
									...TREND_LINE_PROPS,
									xAxis: monthlyXAxisProps(fuelEffData.length),
									yAxis: {
										format: (v: number) => `${v.toFixed(0)} MPG`
									}
								}}
							>
								{#snippet tooltip()}
									<Chart.Tooltip hideLabel />
								{/snippet}
							</LineChart>
						</Chart.Container>
					</div>
					<div
						class="flex flex-wrap items-center justify-center gap-4 text-sm"
						role="list"
						aria-label="Fuel efficiency legend"
					>
						{#each fuelEffSeries as s (s.key)}
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
				</div>
			</Card.Root>
		{/if}

		<!-- Section 4: Financing Overview -->
		<div class="flex items-center gap-2">
			<CreditCard class="h-5 w-5 text-muted-foreground" />
			<h2 class="text-xl font-bold">Financing Overview</h2>
		</div>

		<!-- Financing Summary Cards -->
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
			<Card.Root class="p-4 sm:p-6">
				<div class="space-y-1">
					<p class="text-xs sm:text-sm text-muted-foreground">Total Monthly Payments</p>
					<p class="text-xl sm:text-2xl font-bold">
						{formatCurrency(financing.summary.totalMonthlyPayments)}
					</p>
					<p class="text-xs text-muted-foreground">/month</p>
				</div>
			</Card.Root>
			<Card.Root class="p-4 sm:p-6">
				<div class="space-y-1">
					<p class="text-xs sm:text-sm text-muted-foreground">Remaining Balance</p>
					<p class="text-xl sm:text-2xl font-bold">
						{formatCurrency(financing.summary.remainingBalance)}
					</p>
					<p class="text-xs text-muted-foreground">across all vehicles</p>
				</div>
			</Card.Root>
			<Card.Root class="p-4 sm:p-6">
				<div class="space-y-1">
					<p class="text-xs sm:text-sm text-muted-foreground">Interest Paid YTD</p>
					<p class="text-xl sm:text-2xl font-bold text-destructive">
						{formatCurrency(financing.summary.interestPaidYtd)}
					</p>
					<p class="text-xs text-muted-foreground">on loans</p>
				</div>
			</Card.Root>
			<Card.Root class="p-4 sm:p-6">
				<div class="space-y-1">
					<p class="text-xs sm:text-sm text-muted-foreground">Active Financing</p>
					<p class="text-xl sm:text-2xl font-bold">{financing.summary.activeCount}</p>
					<p class="text-xs text-muted-foreground">
						{financing.summary.loanCount} loan{financing.summary.loanCount !== 1 ? 's' : ''}, {financing
							.summary.leaseCount}
						lease{financing.summary.leaseCount !== 1 ? 's' : ''}
					</p>
				</div>
			</Card.Root>
		</div>

		<!-- Vehicle Financing Details (card-based like Figma) -->
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
			<!-- Loan Payment Breakdown -->
			{#if hasLoanBreakdown}
				<Card.Root class="p-4 sm:p-6">
					<div class="space-y-4">
						<div>
							<h3 class="font-semibold text-sm sm:text-base">Loan Payment Breakdown</h3>
							<p class="text-xs sm:text-sm text-muted-foreground">
								Interest vs Principal over time
							</p>
						</div>
						<div use:animateOnView={'chart-bar-animated'}>
							<Chart.Container config={loanChartConfig} class="h-[250px] sm:h-[300px] w-full">
								<BarChart
									data={loanBreakdownData}
									x="date"
									y={['principal', 'interest']}
									series={loanSeries}
									padding={CHART_PADDING}
									props={{
										bars: { stroke: 'none' },
										xAxis: monthlyXAxisProps(loanBreakdownData.length),
										yAxis: { format: formatCurrencyAxis }
									}}
								>
									{#snippet tooltip()}
										<Chart.Tooltip hideLabel />
									{/snippet}
								</BarChart>
							</Chart.Container>
						</div>
						<div
							class="flex flex-wrap items-center justify-center gap-4 text-sm"
							role="list"
							aria-label="Loan breakdown legend"
						>
							<div class="flex items-center gap-2" role="listitem">
								<div
									class="h-3 w-3 rounded-sm"
									style="background-color: var(--chart-2)"
									aria-hidden="true"
								></div>
								<span class="text-muted-foreground">Principal</span>
							</div>
							<div class="flex items-center gap-2" role="listitem">
								<div
									class="h-3 w-3 rounded-sm"
									style="background-color: var(--chart-3)"
									aria-hidden="true"
								></div>
								<span class="text-muted-foreground">Interest</span>
							</div>
						</div>
					</div>
				</Card.Root>
			{/if}

			<!-- Financing Type Distribution -->
			{#if typeDistData.length > 0}
				<Card.Root class="p-4 sm:p-6">
					<div class="space-y-4">
						<div>
							<h3 class="font-semibold text-sm sm:text-base">Financing Type Distribution</h3>
							<p class="text-xs sm:text-sm text-muted-foreground">Value by financing type</p>
						</div>
						<div
							use:animateOnView={'chart-pie-animated'}
							class="mx-auto aspect-square max-h-[250px] w-full max-w-[250px]"
						>
							<Chart.Container config={typeDistConfig} class="h-full w-full">
								<PieChart
									data={typeDistData}
									key="type"
									value="value"
									label="type"
									cRange={typeDistData.map(d => d.color)}
									innerRadius={60}
									outerRadius={100}
									padAngle={0.02}
									cornerRadius={4}
								>
									{#snippet tooltip()}
										<Chart.Tooltip hideLabel />
									{/snippet}
								</PieChart>
							</Chart.Container>
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

		<!-- Insurance Summary Cards -->
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
			<Card.Root class="p-4 sm:p-6">
				<div class="space-y-1">
					<p class="text-xs sm:text-sm text-muted-foreground">Total Monthly Premiums</p>
					<p class="text-xl sm:text-2xl font-bold">
						{formatCurrency(insurance.summary.totalMonthlyPremiums)}
					</p>
					<p class="text-xs text-muted-foreground">/month</p>
				</div>
			</Card.Root>
			<Card.Root class="p-4 sm:p-6">
				<div class="space-y-1">
					<p class="text-xs sm:text-sm text-muted-foreground">Total Annual Premiums</p>
					<p class="text-xl sm:text-2xl font-bold">
						{formatCurrency(insurance.summary.totalAnnualPremiums)}
					</p>
					<p class="text-xs text-muted-foreground">/year</p>
				</div>
			</Card.Root>
			<Card.Root class="p-4 sm:p-6">
				<div class="space-y-1">
					<p class="text-xs sm:text-sm text-muted-foreground">Active Policies</p>
					<p class="text-xl sm:text-2xl font-bold">
						{insurance.summary.activePoliciesCount}
					</p>
					<p class="text-xs text-muted-foreground">vehicles insured</p>
				</div>
			</Card.Root>
		</div>

		<!-- Insurance Coverage Details (card-based like Figma) -->
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
			<!-- Monthly Premium Trend -->
			{#if premiumTrendData.length > 0}
				<Card.Root class="p-4 sm:p-6">
					<div class="space-y-4">
						<div>
							<h3 class="font-semibold text-sm sm:text-base">Monthly Premium Trends</h3>
							<p class="text-xs sm:text-sm text-muted-foreground">
								Total insurance costs over time
							</p>
						</div>
						<div use:animateOnView={'chart-line-animated'}>
							<Chart.Container config={premiumChartConfig} class="h-[250px] sm:h-[300px] w-full">
								<LineChart
									data={premiumTrendData}
									x="date"
									y="premiums"
									series={premiumSeries}
									padding={CHART_PADDING}
									props={{
										...TREND_LINE_PROPS,
										xAxis: monthlyXAxisProps(premiumTrendData.length),
										yAxis: { format: formatCurrencyAxis }
									}}
								>
									{#snippet tooltip()}
										<Chart.Tooltip hideLabel />
									{/snippet}
								</LineChart>
							</Chart.Container>
						</div>
					</div>
				</Card.Root>
			{/if}

			<!-- Cost by Carrier -->
			{#if carrierData.length > 0}
				<Card.Root class="p-4 sm:p-6">
					<div class="space-y-4">
						<div>
							<h3 class="font-semibold text-sm sm:text-base">Cost by Insurance Carrier</h3>
							<p class="text-xs sm:text-sm text-muted-foreground">Annual premium comparison</p>
						</div>
						<div use:animateOnView={'chart-bar-animated'}>
							<Chart.Container config={carrierChartConfig} class="h-[250px] sm:h-[300px] w-full">
								<BarChart
									data={carrierData}
									x="carrier"
									y="annualPremium"
									series={carrierSeries}
									padding={{ top: 4, left: 48, bottom: 20, right: 4 }}
									props={{
										bars: { stroke: 'none' },
										xAxis: { ticks: carrierData.length },
										yAxis: { format: formatCurrencyAxis }
									}}
								>
									{#snippet tooltip()}
										<Chart.Tooltip hideLabel />
									{/snippet}
								</BarChart>
							</Chart.Container>
						</div>
					</div>
				</Card.Root>
			{/if}
		</div>

		<!-- Insurance Cost Analysis -->
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
