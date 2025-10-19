<script lang="ts">
	import { Progress } from '$lib/components/ui/progress';
	import { Card, CardContent } from '$lib/components/ui/card';
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
			? 'text-green-600'
			: progressPercentage >= 50
				? 'text-blue-600'
				: 'text-orange-600'
	);

	let progressBarClass = $derived(
		progressPercentage > 75
			? 'bg-green-600'
			: progressPercentage >= 50
				? 'bg-blue-600'
				: 'bg-orange-600'
	);
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
	<div
		class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4"
		role="list"
		aria-label="Financing metrics"
	>
		<!-- Original Amount -->
		<Card role="listitem">
			<CardContent class="p-4 sm:pt-6 sm:px-6 sm:pb-6">
				<div class="flex items-start justify-between">
					<div class="space-y-1">
						<p
							class="text-xs sm:text-sm font-medium text-muted-foreground"
							id="original-amount-label"
						>
							Original Amount
						</p>
						<p class="text-xl sm:text-2xl font-bold" aria-labelledby="original-amount-label">
							{formatCurrency(financing.originalAmount)}
						</p>
					</div>
					<div class="rounded-full bg-blue-100 dark:bg-blue-900/20 p-2" aria-hidden="true">
						<DollarSign class="h-4 w-4 sm:h-5 sm:w-5 text-blue-600 dark:text-blue-400" />
					</div>
				</div>
			</CardContent>
		</Card>

		<!-- Current Balance -->
		<Card role="listitem">
			<CardContent class="p-4 sm:pt-6 sm:px-6 sm:pb-6">
				<div class="flex items-start justify-between">
					<div class="space-y-1">
						<p
							class="text-xs sm:text-sm font-medium text-muted-foreground"
							id="current-balance-label"
						>
							Current Balance
						</p>
						<p class="text-xl sm:text-2xl font-bold" aria-labelledby="current-balance-label">
							{formatCurrency(financing.currentBalance)}
						</p>
					</div>
					<div class="rounded-full bg-orange-100 dark:bg-orange-900/20 p-2" aria-hidden="true">
						<Wallet class="h-4 w-4 sm:h-5 sm:w-5 text-orange-600 dark:text-orange-400" />
					</div>
				</div>
			</CardContent>
		</Card>

		<!-- Amount Paid -->
		<Card role="listitem">
			<CardContent class="p-4 sm:pt-6 sm:px-6 sm:pb-6">
				<div class="flex items-start justify-between">
					<div class="space-y-1">
						<p class="text-xs sm:text-sm font-medium text-muted-foreground" id="amount-paid-label">
							Amount Paid
						</p>
						<p class="text-xl sm:text-2xl font-bold" aria-labelledby="amount-paid-label">
							{formatCurrency(amountPaid)}
						</p>
					</div>
					<div class="rounded-full bg-green-100 dark:bg-green-900/20 p-2" aria-hidden="true">
						<TrendingUp class="h-4 w-4 sm:h-5 sm:w-5 text-green-600 dark:text-green-400" />
					</div>
				</div>
			</CardContent>
		</Card>

		<!-- Progress Percentage -->
		<Card role="listitem">
			<CardContent class="p-4 sm:pt-6 sm:px-6 sm:pb-6">
				<div class="flex items-start justify-between">
					<div class="space-y-1">
						<p class="text-xs sm:text-sm font-medium text-muted-foreground" id="progress-label">
							Progress
						</p>
						<p
							class="text-xl sm:text-2xl font-bold {progressColor}"
							aria-labelledby="progress-label"
						>
							{Math.round(progressPercentage)}%
						</p>
					</div>
					<div
						class="rounded-full p-2 {progressPercentage > 75
							? 'bg-green-100 dark:bg-green-900/20'
							: progressPercentage >= 50
								? 'bg-blue-100 dark:bg-blue-900/20'
								: 'bg-orange-100 dark:bg-orange-900/20'}"
						aria-hidden="true"
					>
						<Target
							class="h-4 w-4 sm:h-5 sm:w-5 {progressPercentage > 75
								? 'text-green-600 dark:text-green-400'
								: progressPercentage >= 50
									? 'text-blue-600 dark:text-blue-400'
									: 'text-orange-600 dark:text-orange-400'}"
						/>
					</div>
				</div>
			</CardContent>
		</Card>
	</div>
</div>
