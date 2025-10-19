<script lang="ts">
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Calendar } from 'lucide-svelte';
	import { formatCurrency } from '$lib/utils/formatters';
	import {
		calculateNextPaymentDate,
		calculateDaysUntil,
		formatPaymentFrequency
	} from '$lib/utils/financing-calculations';
	import type { VehicleFinancing, VehicleFinancingPayment } from '$lib/types';

	interface Props {
		financing: VehicleFinancing;
		lastPayment?: VehicleFinancingPayment;
	}

	let { financing, lastPayment }: Props = $props();

	// Calculate next payment date with error handling
	let nextPaymentDate = $derived.by(() => {
		try {
			const lastPaymentDate = lastPayment ? new Date(lastPayment.paymentDate) : undefined;
			return calculateNextPaymentDate(financing, lastPaymentDate);
		} catch (error) {
			console.error('Error calculating next payment date:', error);
			return new Date();
		}
	});

	// Calculate days until payment with error handling
	let daysUntilPayment = $derived.by(() => {
		try {
			return calculateDaysUntil(nextPaymentDate);
		} catch (error) {
			console.error('Error calculating days until payment:', error);
			return 0;
		}
	});

	// Determine styling based on days until payment
	let urgencyLevel = $derived(
		daysUntilPayment < 0
			? 'overdue'
			: daysUntilPayment <= 3
				? 'urgent'
				: daysUntilPayment <= 7
					? 'warning'
					: 'normal'
	);

	let cardBorderClass = $derived(
		urgencyLevel === 'overdue'
			? 'border-red-500 dark:border-red-400'
			: urgencyLevel === 'urgent'
				? 'border-red-400 dark:border-red-500'
				: urgencyLevel === 'warning'
					? 'border-yellow-500 dark:border-yellow-400'
					: 'border-green-500 dark:border-green-400'
	);

	let iconBgClass = $derived(
		urgencyLevel === 'overdue' || urgencyLevel === 'urgent'
			? 'bg-red-100 dark:bg-red-900/20'
			: urgencyLevel === 'warning'
				? 'bg-yellow-100 dark:bg-yellow-900/20'
				: 'bg-green-100 dark:bg-green-900/20'
	);

	let iconColorClass = $derived(
		urgencyLevel === 'overdue' || urgencyLevel === 'urgent'
			? 'text-red-600 dark:text-red-400'
			: urgencyLevel === 'warning'
				? 'text-yellow-600 dark:text-yellow-400'
				: 'text-green-600 dark:text-green-400'
	);

	let badgeVariant = $derived<'default' | 'secondary' | 'destructive' | 'outline'>(
		urgencyLevel === 'overdue' || urgencyLevel === 'urgent'
			? 'destructive'
			: urgencyLevel === 'warning'
				? 'secondary'
				: 'default'
	);

	// Format the due date
	let formattedDueDate = $derived(
		nextPaymentDate.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		})
	);

	// Format the countdown text
	let countdownText = $derived(
		daysUntilPayment < 0
			? `Overdue by ${Math.abs(daysUntilPayment)} day${Math.abs(daysUntilPayment) !== 1 ? 's' : ''}`
			: daysUntilPayment === 0
				? 'Due today'
				: daysUntilPayment === 1
					? 'Due tomorrow'
					: `Due in ${daysUntilPayment} days`
	);
</script>

<Card class="border-2 {cardBorderClass}" role="region" aria-labelledby="next-payment-heading">
	<CardContent class="p-4 sm:pt-6 sm:px-6 sm:pb-6">
		<div class="flex items-start justify-between gap-3">
			<div class="space-y-2 sm:space-y-3 flex-1 min-w-0">
				<div class="flex flex-col sm:flex-row sm:items-center gap-2">
					<h3 class="text-base sm:text-lg font-semibold" id="next-payment-heading">Next Payment</h3>
					<Badge variant={badgeVariant} class="w-fit text-xs" role="status" aria-live="polite">
						{countdownText}
					</Badge>
				</div>

				<div class="space-y-1">
					<p class="text-2xl sm:text-3xl font-bold" aria-label="Payment amount">
						{formatCurrency(financing.paymentAmount)}
					</p>
					<p class="text-xs sm:text-sm text-muted-foreground">
						Due on <time datetime={nextPaymentDate.toISOString()}>{formattedDueDate}</time>
					</p>
				</div>

				<div
					class="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-muted-foreground"
					aria-label="Payment details"
				>
					<span class="font-medium">{formatPaymentFrequency(financing.paymentFrequency)}</span>
					<span aria-hidden="true">•</span>
					<span>{financing.financingType === 'loan' ? 'Loan' : 'Lease'} Payment</span>
				</div>
			</div>

			<div class="rounded-full {iconBgClass} p-2 sm:p-3 flex-shrink-0" aria-hidden="true">
				<Calendar class="h-5 w-5 sm:h-6 sm:w-6 {iconColorClass}" />
			</div>
		</div>
	</CardContent>
</Card>
