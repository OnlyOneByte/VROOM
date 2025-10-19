<script lang="ts">
	import { Card, CardContent } from '$lib/components/ui/card';
	import { DollarSign, Calendar, TrendingUp, Clock } from 'lucide-svelte';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import { calculateDaysUntil } from '$lib/utils/financing-calculations';
	import type { VehicleFinancing } from '$lib/types.js';

	interface Props {
		financing: VehicleFinancing;
		totalInterestPaid: number;
		estimatedPayoffDate: Date;
		nextPaymentDate: Date;
	}

	let { financing, totalInterestPaid, estimatedPayoffDate, nextPaymentDate }: Props = $props();

	// Calculate total amount paid
	let totalAmountPaid = $derived(financing.originalAmount - financing.currentBalance);

	// Calculate days until next payment
	let daysUntilNextPayment = $derived(calculateDaysUntil(nextPaymentDate));

	// Determine next payment card styling based on days remaining
	let nextPaymentColorClass = $derived(
		daysUntilNextPayment < 0
			? 'text-red-600 dark:text-red-400'
			: daysUntilNextPayment <= 3
				? 'text-red-600 dark:text-red-400'
				: daysUntilNextPayment <= 7
					? 'text-yellow-600 dark:text-yellow-400'
					: 'text-green-600 dark:text-green-400'
	);

	let nextPaymentBgClass = $derived(
		daysUntilNextPayment < 0
			? 'bg-red-100 dark:bg-red-900/20'
			: daysUntilNextPayment <= 3
				? 'bg-red-100 dark:bg-red-900/20'
				: daysUntilNextPayment <= 7
					? 'bg-yellow-100 dark:bg-yellow-900/20'
					: 'bg-green-100 dark:bg-green-900/20'
	);

	let nextPaymentIconClass = $derived(
		daysUntilNextPayment < 0
			? 'text-red-600 dark:text-red-400'
			: daysUntilNextPayment <= 3
				? 'text-red-600 dark:text-red-400'
				: daysUntilNextPayment <= 7
					? 'text-yellow-600 dark:text-yellow-400'
					: 'text-green-600 dark:text-green-400'
	);

	// Format next payment status text
	let nextPaymentStatusText = $derived(
		daysUntilNextPayment < 0
			? `Overdue by ${Math.abs(daysUntilNextPayment)} day${Math.abs(daysUntilNextPayment) !== 1 ? 's' : ''}`
			: daysUntilNextPayment === 0
				? 'Due today'
				: `Due in ${daysUntilNextPayment} day${daysUntilNextPayment !== 1 ? 's' : ''}`
	);
</script>

<div
	class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4"
	role="list"
	aria-label="Payment metrics"
>
	<!-- Total Interest Paid (loans only) -->
	{#if financing.financingType === 'loan' && financing.apr && financing.apr > 0}
		<Card role="listitem">
			<CardContent class="p-4 sm:pt-6 sm:px-6 sm:pb-6">
				<div class="flex items-start justify-between">
					<div class="space-y-1">
						<p
							class="text-xs sm:text-sm font-medium text-muted-foreground"
							id="total-interest-label"
						>
							Total Interest Paid
						</p>
						<p class="text-xl sm:text-2xl font-bold" aria-labelledby="total-interest-label">
							{formatCurrency(totalInterestPaid)}
						</p>
					</div>
					<div class="rounded-full bg-orange-100 dark:bg-orange-900/20 p-2" aria-hidden="true">
						<TrendingUp class="h-4 w-4 sm:h-5 sm:w-5 text-orange-600 dark:text-orange-400" />
					</div>
				</div>
			</CardContent>
		</Card>
	{/if}

	<!-- Total Amount Paid -->
	<Card role="listitem">
		<CardContent class="p-4 sm:pt-6 sm:px-6 sm:pb-6">
			<div class="flex items-start justify-between">
				<div class="space-y-1">
					<p class="text-xs sm:text-sm font-medium text-muted-foreground" id="total-paid-label">
						Total Amount Paid
					</p>
					<p class="text-xl sm:text-2xl font-bold" aria-labelledby="total-paid-label">
						{formatCurrency(totalAmountPaid)}
					</p>
				</div>
				<div class="rounded-full bg-blue-100 dark:bg-blue-900/20 p-2" aria-hidden="true">
					<DollarSign class="h-4 w-4 sm:h-5 sm:w-5 text-blue-600 dark:text-blue-400" />
				</div>
			</div>
		</CardContent>
	</Card>

	<!-- Estimated Payoff Date -->
	<Card role="listitem">
		<CardContent class="p-4 sm:pt-6 sm:px-6 sm:pb-6">
			<div class="flex items-start justify-between">
				<div class="space-y-1">
					<p class="text-xs sm:text-sm font-medium text-muted-foreground" id="payoff-date-label">
						Estimated Payoff Date
					</p>
					<time
						class="text-lg sm:text-2xl font-bold break-words block"
						datetime={estimatedPayoffDate.toISOString()}
						aria-labelledby="payoff-date-label">{formatDate(estimatedPayoffDate)}</time
					>
				</div>
				<div class="rounded-full bg-purple-100 dark:bg-purple-900/20 p-2" aria-hidden="true">
					<Calendar class="h-4 w-4 sm:h-5 sm:w-5 text-purple-600 dark:text-purple-400" />
				</div>
			</div>
		</CardContent>
	</Card>

	<!-- Next Payment Due -->
	<Card role="listitem">
		<CardContent class="p-4 sm:pt-6 sm:px-6 sm:pb-6">
			<div class="flex items-start justify-between">
				<div class="space-y-1">
					<p class="text-xs sm:text-sm font-medium text-muted-foreground" id="next-payment-label">
						Next Payment Due
					</p>
					<p class="text-xl sm:text-2xl font-bold" aria-labelledby="next-payment-label">
						{formatCurrency(financing.paymentAmount)}
					</p>
					<p
						class="text-xs sm:text-sm font-medium {nextPaymentColorClass}"
						role="status"
						aria-live="polite"
					>
						{nextPaymentStatusText}
					</p>
				</div>
				<div class="rounded-full p-2 {nextPaymentBgClass}" aria-hidden="true">
					<Clock class="h-4 w-4 sm:h-5 sm:w-5 {nextPaymentIconClass}" />
				</div>
			</div>
		</CardContent>
	</Card>
</div>
