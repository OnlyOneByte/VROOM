<script lang="ts">
	import '$lib/components/charts/pie-chart-animations.css';
	import '$lib/components/charts/bar-chart-animations.css';
	import { createVisibilityWatch } from '$lib/utils/visibility-watch.svelte';
	import { PieChart } from 'layerchart';
	import { CreditCard } from '@lucide/svelte';
	import * as Card from '$lib/components/ui/card';
	import * as Chart from '$lib/components/ui/chart';
	import { Badge } from '$lib/components/ui/badge';
	import { AppBarChart, StatCardGrid } from '$lib/components/charts';
	import type { FinancingResponse } from '$lib/types';
	import { formatCurrency } from '$lib/utils/formatters';
	import { parseMonthToDate } from '$lib/utils/chart-formatters';

	let { financing }: { financing: FinancingResponse } = $props();

	let typeDistGate = createVisibilityWatch();

	// --- Loan Payment Breakdown ---
	let loanBreakdownData = $derived(
		(financing.loanBreakdown ?? []).map(d => ({ ...d, date: parseMonthToDate(d.month) }))
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

	// --- Type Distribution Pie ---
	let typeDistData = $derived(
		(financing.typeDistribution ?? []).map(d => ({
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

	let financingSummaryItems = $derived.by(() => {
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
</script>

<!-- Section 4: Financing Overview -->
<div class="flex items-center gap-2">
	<CreditCard class="h-5 w-5 text-muted-foreground" />
	<h2 class="text-xl font-bold">Financing Overview</h2>
</div>

<!-- Financing Summary Cards -->
<StatCardGrid items={financingSummaryItems} columns={4} />

<!-- Vehicle Financing Details -->
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

	<!-- Financing Type Distribution -->
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
