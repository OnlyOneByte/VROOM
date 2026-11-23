<script lang="ts">
	import { CreditCard } from '@lucide/svelte';
	import * as Card from '#lib/components/ui/card/index.ts';
	import type * as Chart from '#lib/components/ui/chart/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { AppBarChart, AppPieChart } from '#lib/components/charts/index.ts';
	import StatCardGrid from '#lib/components/charts/StatCardGrid.svelte';
	import type { FinancingResponse } from '#lib/types/index.ts';
	import { capitalize, formatCurrency, formatNumber } from '#lib/utils/formatters.ts';
	import { parseMonthToDate } from '#lib/utils/chart-formatters.ts';

	let { financing }: { financing: FinancingResponse } = $props();

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

	let typeDistData = $derived(
		(financing.typeDistribution ?? []).map(d => ({
			key: d.type,
			label: capitalize(d.type),
			value: d.value,
			color:
				d.type === 'loan'
					? 'var(--chart-1)'
					: d.type === 'lease'
						? 'var(--chart-3)'
						: 'var(--chart-2)'
		}))
	);

	function vehicleCountLabel(type: string): string {
		const count = financing.typeDistribution?.find(d => d.type === type)?.count ?? 0;
		return `${count} vehicle${count !== 1 ? 's' : ''}`;
	}

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
				label: 'Est. Monthly Interest',
				value: formatCurrency(s.monthlyInterestEstimate),
				subtitle: 'on current loan balances'
			},
			{
				label: 'Active Financing',
				value: String(s.activeCount),
				subtitle: `${s.loanCount} loan${s.loanCount !== 1 ? 's' : ''}, ${s.leaseCount} lease${s.leaseCount !== 1 ? 's' : ''}`
			}
		];
	});
</script>

<div class="flex items-center gap-2">
	<CreditCard class="h-5 w-5 text-muted-foreground" />
	<h2 class="text-xl font-bold">Financing Overview</h2>
</div>

<StatCardGrid items={financingSummaryItems} columns={4} />

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
										{vehicle.financingType === 'own' ? 'Owned' : capitalize(vehicle.financingType)}
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
													{vehicle.apr != null ? `${formatNumber(vehicle.apr, 1)}%` : '—'}
												</p>
											</div>
											<div>
												<p class="text-muted-foreground">Est. Monthly Interest</p>
												<p class="font-semibold text-destructive">
													{formatCurrency(vehicle.monthlyInterestEstimate)}
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

<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
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

	{#if typeDistData.length > 0}
		<AppPieChart
			title="Financing Type Distribution"
			description="Value by financing type"
			data={typeDistData}
			legendLabel="Financing types"
			formatLegendValue={item => vehicleCountLabel(item.key)}
		/>
	{/if}
</div>
