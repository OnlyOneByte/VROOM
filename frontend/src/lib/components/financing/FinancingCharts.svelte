<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { ChartContainer, ChartTooltip } from '$lib/components/ui/chart';
	import type { ChartConfig } from '$lib/components/ui/chart';
	import { BarChart } from 'layerchart';
	import type { VehicleFinancing } from '$lib/types';
	import type { AmortizationEntry } from '$lib/utils/financing-calculations';
	import { formatCurrencyAxis } from '$lib/utils/chart-formatters';

	interface Props {
		financing: VehicleFinancing;
		amortizationSchedule?: AmortizationEntry[];
	}

	let { financing, amortizationSchedule = [] }: Props = $props();

	// Show amortization chart only for loans with APR > 0
	let showAmortizationChart = $derived(
		financing.financingType === 'loan' &&
			financing.apr &&
			financing.apr > 0 &&
			amortizationSchedule.length > 0
	);

	// Prepare data for stacked bar chart with optimization for large datasets
	let amortizationChartData = $derived.by(() => {
		if (!showAmortizationChart) return [];

		const MAX_CHART_POINTS = 100;
		const dataLength = amortizationSchedule.length;

		if (dataLength <= MAX_CHART_POINTS) {
			return amortizationSchedule.map(entry => ({
				paymentNumber: entry.paymentNumber,
				principal: entry.principalAmount,
				interest: entry.interestAmount,
				isPaid: entry.isPaid,
				paymentDate: entry.paymentDate,
				remainingBalance: entry.remainingBalance
			}));
		}

		const samplingRate = Math.ceil(dataLength / MAX_CHART_POINTS);
		const sampledData = [];

		for (let i = 0; i < dataLength; i += samplingRate) {
			const entry = amortizationSchedule[i];
			if (entry) {
				sampledData.push({
					paymentNumber: entry.paymentNumber,
					principal: entry.principalAmount,
					interest: entry.interestAmount,
					isPaid: entry.isPaid,
					paymentDate: entry.paymentDate,
					remainingBalance: entry.remainingBalance
				});
			}
		}

		const lastEntry = amortizationSchedule[dataLength - 1];
		if (
			lastEntry &&
			sampledData[sampledData.length - 1]?.paymentNumber !== lastEntry.paymentNumber
		) {
			sampledData.push({
				paymentNumber: lastEntry.paymentNumber,
				principal: lastEntry.principalAmount,
				interest: lastEntry.interestAmount,
				isPaid: lastEntry.isPaid,
				paymentDate: lastEntry.paymentDate,
				remainingBalance: lastEntry.remainingBalance
			});
		}

		return sampledData;
	});

	const amortizationSeries = $derived([
		{
			key: 'principal',
			label: 'Principal',
			color: 'var(--chart-2)'
		},
		{
			key: 'interest',
			label: 'Interest',
			color: 'var(--chart-3)'
		}
	]);

	const amortizationChartConfig: ChartConfig = {
		principal: {
			label: 'Principal',
			color: 'var(--chart-2)'
		},
		interest: {
			label: 'Interest',
			color: 'var(--chart-3)'
		}
	};
</script>

{#if showAmortizationChart}
	<Card>
		<CardHeader class="p-4 sm:p-6">
			<CardTitle class="text-base sm:text-lg" id="amortization-chart-title"
				>Amortization Schedule</CardTitle
			>
			<p class="text-xs sm:text-sm text-muted-foreground">
				Payment breakdown per month — principal vs interest
			</p>
		</CardHeader>
		<CardContent class="p-4 sm:p-6">
			<!-- Legend -->
			<div
				class="mb-3 flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-xs sm:text-sm"
				role="list"
				aria-label="Amortization chart legend"
			>
				<div class="flex items-center gap-2" role="listitem">
					<div
						class="h-3 w-3 rounded-sm flex-shrink-0"
						style="background-color: var(--chart-2)"
						aria-hidden="true"
					></div>
					<span class="text-muted-foreground">Principal</span>
				</div>
				<div class="flex items-center gap-2" role="listitem">
					<div
						class="h-3 w-3 rounded-sm flex-shrink-0"
						style="background-color: var(--chart-3)"
						aria-hidden="true"
					></div>
					<span class="text-muted-foreground">Interest</span>
				</div>
			</div>

			<ChartContainer
				config={amortizationChartConfig}
				class="h-[250px] sm:h-[300px] w-full pl-6"
				role="img"
				aria-labelledby="amortization-chart-title"
				aria-describedby="amortization-chart-desc"
			>
				<BarChart
					data={amortizationChartData}
					x="paymentNumber"
					y={['principal', 'interest']}
					series={amortizationSeries}
					props={{
						bars: {
							stroke: 'none'
						},
						xAxis: {
							ticks: Math.min(amortizationChartData.length, 8),
							format: (v: number) => `#${v}`,
							label: 'Payment Number'
						},
						yAxis: {
							format: formatCurrencyAxis,
							label: 'Amount ($)'
						}
					}}
				>
					{#snippet tooltip()}
						<ChartTooltip hideLabel />
					{/snippet}
				</BarChart>
			</ChartContainer>

			<div id="amortization-chart-desc" class="sr-only">
				Stacked bar chart showing amortization schedule with {amortizationSchedule.length} payments.
				Each bar shows the breakdown of principal and interest for each payment.
			</div>
		</CardContent>
	</Card>
{/if}
