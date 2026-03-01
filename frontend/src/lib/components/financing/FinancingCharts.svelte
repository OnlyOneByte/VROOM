<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { ChartContainer, ChartTooltip } from '$lib/components/ui/chart';
	import type { ChartConfig } from '$lib/components/ui/chart';
	import { Chart, Svg, Arc, Group, Text, BarChart } from 'layerchart';
	import type { VehicleFinancing, VehicleFinancingPayment } from '$lib/types';
	import type { AmortizationEntry } from '$lib/utils/financing-calculations';
	import { formatCurrency } from '$lib/utils/formatters';
	import { formatCurrencyAxis } from '$lib/utils/chart-formatters';

	interface Props {
		financing: VehicleFinancing;
		payments: VehicleFinancingPayment[];
		amortizationSchedule?: AmortizationEntry[];
	}

	let { financing, payments, amortizationSchedule = [] }: Props = $props();

	// Calculate metrics for the donut chart with error handling
	let amountPaid = $derived.by(() => {
		try {
			if (!financing || !financing.originalAmount || !financing.currentBalance) return 0;
			return Math.max(0, financing.originalAmount - financing.currentBalance);
		} catch (error) {
			if (import.meta.env.DEV) console.error('Error calculating amount paid:', error);
			return 0;
		}
	});

	let progressPercentage = $derived.by(() => {
		try {
			if (!financing || !financing.originalAmount || financing.originalAmount <= 0) return 0;
			return (amountPaid / financing.originalAmount) * 100;
		} catch (error) {
			if (import.meta.env.DEV) console.error('Error calculating progress percentage:', error);
			return 0;
		}
	});

	// Calculate principal and interest paid from actual payments with error handling
	let principalPaid = $derived.by(() => {
		try {
			return payments.reduce((sum, payment) => sum + (payment.principalAmount || 0), 0);
		} catch (error) {
			if (import.meta.env.DEV) console.error('Error calculating principal paid:', error);
			return 0;
		}
	});

	let interestPaid = $derived.by(() => {
		try {
			return payments.reduce((sum, payment) => sum + (payment.interestAmount || 0), 0);
		} catch (error) {
			if (import.meta.env.DEV) console.error('Error calculating interest paid:', error);
			return 0;
		}
	});

	// Inner ring data: Paid vs Remaining
	let innerRingData = $derived([
		{
			name: 'Paid',
			value: amountPaid,
			fill: 'var(--chart-1)'
		},
		{
			name: 'Remaining',
			value: financing.currentBalance,
			fill: 'var(--chart-5)'
		}
	]);

	// Outer ring data: Principal vs Interest (only for loans with APR)
	let outerRingData = $derived.by(() => {
		if (financing.financingType !== 'loan' || !financing.apr || financing.apr <= 0) {
			return [];
		}

		return [
			{
				name: 'Principal Paid',
				value: principalPaid,
				fill: 'var(--chart-2)'
			},
			{
				name: 'Interest Paid',
				value: interestPaid,
				fill: 'var(--chart-3)'
			},
			{
				name: 'Remaining Balance',
				value: financing.currentBalance,
				fill: 'var(--chart-5)'
			}
		];
	});

	// Chart configuration
	const chartConfig: ChartConfig = {
		paid: {
			label: 'Paid',
			color: 'var(--chart-1)'
		},
		remaining: {
			label: 'Remaining',
			color: 'var(--chart-5)'
		},
		principal: {
			label: 'Principal',
			color: 'var(--chart-2)'
		},
		interest: {
			label: 'Interest',
			color: 'var(--chart-3)'
		}
	};

	// Show outer ring only for loans with APR
	let showOuterRing = $derived(
		financing.financingType === 'loan' && financing.apr && financing.apr > 0
	);

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

		// For large datasets (>100 payments), sample every nth payment to reduce chart complexity
		const MAX_CHART_POINTS = 100;
		const dataLength = amortizationSchedule.length;

		if (dataLength <= MAX_CHART_POINTS) {
			// Use all data points for smaller datasets
			return amortizationSchedule.map(entry => ({
				paymentNumber: entry.paymentNumber,
				principal: entry.principalAmount,
				interest: entry.interestAmount,
				isPaid: entry.isPaid,
				paymentDate: entry.paymentDate,
				remainingBalance: entry.remainingBalance
			}));
		}

		// Sample data points for large datasets
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

		// Always include the last payment
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

	// Series configuration for amortization chart
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

	// Extended chart configuration for amortization
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

<Card>
	<CardHeader class="p-4 sm:p-6">
		<CardTitle class="text-base sm:text-lg" id="payment-progress-chart-title"
			>Payment Progress</CardTitle
		>
	</CardHeader>
	<CardContent class="p-4 sm:p-6">
		<ChartContainer
			config={chartConfig}
			class="mx-auto aspect-square max-h-[250px] sm:max-h-[300px]"
			role="img"
			aria-labelledby="payment-progress-chart-title"
			aria-describedby="payment-progress-chart-desc"
		>
			<Chart data={innerRingData} x="name" y="value" r="value">
				<Svg>
					<Group center>
						<!-- Inner ring: Paid vs Remaining -->
						<Arc
							innerRadius={showOuterRing ? 80 : 60}
							outerRadius={showOuterRing ? 100 : 90}
							cornerRadius={4}
							padAngle={0.02}
						/>

						<!-- Outer ring: Principal vs Interest (only for loans) -->
						{#if showOuterRing && outerRingData.length > 0}
							<Arc
								data={outerRingData}
								innerRadius={105}
								outerRadius={125}
								cornerRadius={4}
								padAngle={0.02}
							/>
						{/if}

						<!-- Center text: Percentage -->
						<Text
							value={`${Math.round(progressPercentage)}%`}
							class="fill-foreground text-3xl font-bold"
							textAnchor="middle"
							verticalAnchor="middle"
							dy={-5}
						/>
						<Text
							value="Complete"
							class="fill-muted-foreground text-sm"
							textAnchor="middle"
							verticalAnchor="middle"
							dy={15}
						/>
					</Group>
				</Svg>
			</Chart>
		</ChartContainer>

		<!-- Screen reader description -->
		<div id="payment-progress-chart-desc" class="sr-only">
			Donut chart showing payment progress. {Math.round(progressPercentage)}% complete. Amount paid: {formatCurrency(
				amountPaid
			)}. Remaining balance: {formatCurrency(financing.currentBalance)}.
			{#if showOuterRing}
				Principal paid: {formatCurrency(principalPaid)}. Interest paid: {formatCurrency(
					interestPaid
				)}.
			{/if}
		</div>

		<!-- Legend -->
		<div class="mt-4 sm:mt-6 space-y-2" role="list" aria-label="Chart legend">
			<div class="flex items-center justify-between text-xs sm:text-sm" role="listitem">
				<div class="flex items-center gap-2">
					<div
						class="h-3 w-3 rounded-sm flex-shrink-0"
						style="background-color: var(--chart-1)"
						aria-hidden="true"
					></div>
					<span class="text-muted-foreground">Amount Paid</span>
				</div>
				<span class="font-medium">{formatCurrency(amountPaid)}</span>
			</div>
			<div class="flex items-center justify-between text-xs sm:text-sm" role="listitem">
				<div class="flex items-center gap-2">
					<div
						class="h-3 w-3 rounded-sm flex-shrink-0"
						style="background-color: var(--chart-5)"
						aria-hidden="true"
					></div>
					<span class="text-muted-foreground">Remaining Balance</span>
				</div>
				<span class="font-medium">{formatCurrency(financing.currentBalance)}</span>
			</div>

			{#if showOuterRing}
				<div class="mt-3 sm:mt-4 border-t pt-2">
					<div class="flex items-center justify-between text-xs sm:text-sm" role="listitem">
						<div class="flex items-center gap-2">
							<div
								class="h-3 w-3 rounded-sm flex-shrink-0"
								style="background-color: var(--chart-2)"
								aria-hidden="true"
							></div>
							<span class="text-muted-foreground">Principal Paid</span>
						</div>
						<span class="font-medium">{formatCurrency(principalPaid)}</span>
					</div>
					<div class="flex items-center justify-between text-xs sm:text-sm" role="listitem">
						<div class="flex items-center gap-2">
							<div
								class="h-3 w-3 rounded-sm flex-shrink-0"
								style="background-color: var(--chart-3)"
								aria-hidden="true"
							></div>
							<span class="text-muted-foreground">Interest Paid</span>
						</div>
						<span class="font-medium">{formatCurrency(interestPaid)}</span>
					</div>
				</div>
			{/if}
		</div>
	</CardContent>
</Card>

<!-- Amortization Schedule Chart -->
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
			<!-- Legend (above chart so x-axis labels are unobstructed) -->
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
				class="h-[250px] sm:h-[300px] w-full"
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

			<!-- Screen reader description -->
			<div id="amortization-chart-desc" class="sr-only">
				Stacked bar chart showing amortization schedule with {amortizationSchedule.length} payments.
				Each bar shows the breakdown of principal and interest for each payment. Completed payments are
				shown at full opacity, future payments are dimmed.
			</div>
		</CardContent>
	</Card>
{/if}
