<script lang="ts">
	import type { ChartConfig } from '#lib/components/ui/chart/index.ts';
	import { AppBarChart } from '#lib/components/charts/index.ts';
	import type { VehicleFinancing } from '#lib/types/index.ts';
	import type { AmortizationEntry } from '#lib/utils/financing-calculations.ts';

	interface Props {
		financing: VehicleFinancing;
		amortizationSchedule?: AmortizationEntry[];
	}

	let { financing, amortizationSchedule = [] }: Props = $props();

	let showAmortizationChart = $derived(
		financing.financingType === 'loan' &&
			financing.apr &&
			financing.apr > 0 &&
			amortizationSchedule.length > 0
	);

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
	<AppBarChart
		level={3}
		title="Payment schedule"
		description="Principal and interest in each payment"
		data={amortizationChartData}
		x="paymentNumber"
		y={['principal', 'interest']}
		seriesLayout="stack"
		series={amortizationSeries}
		config={amortizationChartConfig}
		xAxisProps={{
			ticks: Math.min(amortizationChartData.length, 8),
			format: (v: number) => `#${v}`
		}}
		tooltipLabelFormat={v => `Payment #${v}`}
	>
		{#snippet footer()}
			<p class="sr-only">
				Stacked bar chart showing amortization schedule with {amortizationSchedule.length} payments. Each
				bar shows the breakdown of principal and interest for each payment.
			</p>
		{/snippet}
	</AppBarChart>
{/if}
