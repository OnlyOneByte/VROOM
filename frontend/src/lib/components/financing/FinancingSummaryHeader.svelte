<script lang="ts">
	import { Progress } from '$lib/components/ui/progress';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { StatCardGrid } from '$lib/components/charts';
	import { DollarSign, TrendingUp, Wallet, Target } from 'lucide-svelte';
	import { formatCurrency } from '$lib/utils/formatters';
	import type { VehicleFinancing } from '$lib/types';

	interface Props {
		financing: VehicleFinancing;
		progressPercentage: number;
	}

	let { financing, progressPercentage }: Props = $props();

	// Calculate amount paid
	let amountPaid = $derived(financing.originalAmount - financing.currentBalance);

	// Determine progress color based on percentage
	let progressColor = $derived(
		progressPercentage > 75
			? 'text-chart-2'
			: progressPercentage >= 50
				? 'text-chart-3'
				: 'text-chart-1'
	);

	let progressBarClass = $derived(
		progressPercentage > 75 ? 'bg-chart-2' : progressPercentage >= 50 ? 'bg-chart-3' : 'bg-chart-1'
	);

	// Dynamic icon color for progress card based on percentage
	let progressIconColor = $derived(
		progressPercentage > 75 ? 'chart-2' : progressPercentage >= 50 ? 'chart-3' : 'chart-1'
	);

	let metricItems = $derived([
		{
			label: 'Original Amount',
			value: formatCurrency(financing.originalAmount),
			icon: DollarSign,
			iconColor: 'chart-3'
		},
		{
			label: 'Current Balance',
			value: formatCurrency(financing.currentBalance),
			icon: Wallet,
			iconColor: 'chart-1'
		},
		{
			label: 'Amount Paid',
			value: formatCurrency(amountPaid),
			icon: TrendingUp,
			iconColor: 'chart-2'
		},
		{
			label: 'Progress',
			value: `${Math.round(progressPercentage)}%`,
			icon: Target,
			iconColor: progressIconColor
		}
	]);
</script>

<div class="space-y-4 sm:space-y-6">
	<!-- Progress Bar Section -->
	<Card>
		<CardContent class="p-4 sm:p-6">
			<div class="space-y-3">
				<div class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
					<h3 class="text-base sm:text-lg font-semibold" id="payment-progress-heading">
						Payment Progress
					</h3>
					<span
						class="text-xl sm:text-2xl font-bold {progressColor}"
						aria-label="Progress percentage"
					>
						{Math.round(progressPercentage)}%
					</span>
				</div>
				<div class="relative">
					<Progress
						value={progressPercentage}
						max={100}
						class="h-3 sm:h-4"
						aria-label="Payment progress"
						aria-valuenow={Math.round(progressPercentage)}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-describedby="payment-progress-heading"
					/>
					<div
						class="absolute top-0 left-0 h-3 sm:h-4 rounded-full transition-all {progressBarClass}"
						style="width: {progressPercentage}%"
						aria-hidden="true"
					></div>
				</div>
				<div
					class="flex justify-between text-xs sm:text-sm text-muted-foreground"
					aria-hidden="true"
				>
					<span>Started</span>
					<span>Paid Off</span>
				</div>
			</div>
		</CardContent>
	</Card>

	<!-- Metrics Grid -->
	<StatCardGrid items={metricItems} columns={4} />
</div>
