<script lang="ts">
	import { Shield, DollarSign } from '@lucide/svelte';
	import * as Card from '$lib/components/ui/card';
	import * as Chart from '$lib/components/ui/chart';
	import { Badge } from '$lib/components/ui/badge';
	import { AppLineChart, AppBarChart, StatCardGrid } from '$lib/components/charts';
	import type { InsuranceResponse } from '$lib/types';
	import { formatCurrency } from '$lib/utils/formatters';
	import { parseMonthToDate } from '$lib/utils/chart-formatters';

	let { insurance }: { insurance: InsuranceResponse } = $props();

	// --- Premium Trends ---
	let premiumTrendData = $derived(
		(insurance.monthlyPremiumTrend ?? []).map(d => ({ ...d, date: parseMonthToDate(d.month) }))
	);

	const premiumChartConfig: Chart.ChartConfig = {
		premiums: { label: 'Premiums', color: 'var(--chart-4)' }
	};

	const premiumSeries = [{ key: 'premiums', label: 'Premiums', color: 'var(--chart-4)' }];

	// --- Cost by Carrier ---
	let carrierData = $derived(insurance.costByCarrier ?? []);

	const carrierChartConfig: Chart.ChartConfig = {
		annualPremium: { label: 'Annual Premium', color: 'var(--chart-4)' }
	};

	const carrierSeries = [
		{ key: 'annualPremium', label: 'Annual Premium', color: 'var(--chart-4)' }
	];

	// --- Summary Items ---
	let insuranceSummaryItems = $derived.by(() => {
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

	// --- Cost Analysis ---
	let avgCostPerVehicle = $derived.by(() => {
		if (insurance.vehicleDetails.length === 0) return 0;
		return insurance.summary.totalMonthlyPremiums / insurance.vehicleDetails.length;
	});

	let mostExpensiveVehicle = $derived.by(() => {
		if (insurance.vehicleDetails.length === 0) return null;
		return insurance.vehicleDetails.reduce((max, v) =>
			v.monthlyPremium > max.monthlyPremium ? v : max
		);
	});
</script>

<!-- Section 5: Insurance Overview -->
<div class="flex items-center gap-2 mt-4">
	<Shield class="h-5 w-5 text-muted-foreground" />
	<h2 class="text-xl font-bold">Insurance Overview</h2>
</div>

<!-- Insurance Summary Cards -->
<StatCardGrid items={insuranceSummaryItems} columns={3} />

<!-- Insurance Coverage Details -->
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
	<!-- Monthly Premium Trends -->
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

	<!-- Cost by Carrier -->
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
					{mostExpensiveVehicle ? `${formatCurrency(mostExpensiveVehicle.monthlyPremium)}/mo` : '—'}
				</p>
				<p class="text-xs text-muted-foreground mt-1">
					{mostExpensiveVehicle?.vehicleName ?? '—'}
				</p>
			</div>
		</div>
	</div>
</Card.Root>
