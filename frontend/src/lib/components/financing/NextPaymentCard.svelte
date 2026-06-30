<script lang="ts">
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Progress } from '$lib/components/ui/progress';
	import { Calendar, CreditCard, ArrowRightLeft } from '@lucide/svelte';
	import { formatCurrency } from '$lib/utils/formatters';
	import {
		calculateNextPaymentDate,
		calculateDaysUntil,
		calculateMinimumPayment,
		formatPaymentFrequency
	} from '$lib/utils/financing-calculations';
	import type { VehicleFinancing, DerivedPaymentEntry } from '$lib/types';

	interface Props {
		financing: VehicleFinancing;
		lastPayment?: DerivedPaymentEntry;
		recordPaymentHref?: string;
		progressPercentage?: number;
		onChangePayment?: () => void;
		/** vehicle-sharing T12b-3b: the payment actions (Record Payment, Change payment) are owner-only
		 *  finance management (the server keeps strict validateVehicleOwnership on /financing). A shared
		 *  invitee sees the next-payment summary read-only. Default true so the owner view is unchanged. */
		isOwner?: boolean;
	}

	let {
		financing,
		lastPayment,
		recordPaymentHref,
		progressPercentage = 0,
		onChangePayment,
		isOwner = true
	}: Props = $props();

	let minimumPayment = $derived(calculateMinimumPayment(financing));

	// Calculate next payment date
	let nextPaymentDate = $derived.by(() => {
		try {
			const lastPaymentDate = lastPayment ? new Date(lastPayment.expense.date) : undefined;
			return calculateNextPaymentDate(financing, lastPaymentDate);
		} catch (error) {
			if (import.meta.env.DEV) console.error('Error calculating next payment date:', error);
			return new Date();
		}
	});

	let daysUntilPayment = $derived.by(() => {
		try {
			return calculateDaysUntil(nextPaymentDate);
		} catch (error) {
			if (import.meta.env.DEV) console.error('Error calculating days until payment:', error);
			return 0;
		}
	});

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
		urgencyLevel === 'overdue' || urgencyLevel === 'urgent'
			? 'border-destructive'
			: urgencyLevel === 'warning'
				? 'border-chart-5'
				: 'border-chart-2'
	);

	let badgeVariant = $derived<'default' | 'secondary' | 'destructive' | 'outline'>(
		urgencyLevel === 'overdue' || urgencyLevel === 'urgent'
			? 'destructive'
			: urgencyLevel === 'warning'
				? 'secondary'
				: 'default'
	);

	let formattedDueDate = $derived(
		nextPaymentDate.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		})
	);

	let countdownText = $derived(
		daysUntilPayment < 0
			? `Overdue by ${Math.abs(daysUntilPayment)} day${Math.abs(daysUntilPayment) !== 1 ? 's' : ''}`
			: daysUntilPayment === 0
				? 'Due today'
				: daysUntilPayment === 1
					? 'Due tomorrow'
					: `Due in ${daysUntilPayment} days`
	);

	// (progressColor for the % text was removed: chart-1/chart-2 on white fail WCAG AA.
	// The % now uses text-foreground; the colored bar below carries the progress signal.)
	let progressIndicatorClass = $derived(
		progressPercentage > 75
			? '[&_[data-slot=progress-indicator]]:bg-chart-2'
			: progressPercentage >= 50
				? '[&_[data-slot=progress-indicator]]:bg-chart-3'
				: '[&_[data-slot=progress-indicator]]:bg-chart-1'
	);

	let showMinimum = $derived(
		minimumPayment !== null && financing.paymentAmount > minimumPayment + 0.01
	);

	let amountPaid = $derived(
		Math.max(0, financing.originalAmount - (financing.computedBalance ?? 0))
	);
</script>

<Card class="border-2 {cardBorderClass}" role="region" aria-labelledby="next-payment-heading">
	<CardContent class="p-4 sm:p-6">
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
			<!-- Left: Next Payment Info -->
			<div class="space-y-3">
				<div class="flex items-start justify-between gap-3">
					<div class="space-y-2 flex-1 min-w-0">
						<div class="flex flex-col sm:flex-row sm:items-center gap-2">
							<h3 class="text-base sm:text-lg font-semibold" id="next-payment-heading">
								Next Payment
							</h3>
							<Badge variant={badgeVariant} class="w-fit text-xs" role="status" aria-live="polite">
								{countdownText}
							</Badge>
						</div>

						<div class="flex items-baseline gap-2">
							<p class="text-2xl sm:text-3xl font-bold" aria-label="Payment amount">
								{formatCurrency(financing.paymentAmount)}
							</p>
							{#if showMinimum}
								<span class="text-sm font-normal text-muted-foreground">
									Min: {formatCurrency(minimumPayment ?? 0)}
								</span>
							{/if}
						</div>

						<p class="text-xs sm:text-sm text-muted-foreground">
							Due on <time datetime={nextPaymentDate.toISOString()}>{formattedDueDate}</time>
						</p>

						<div class="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-muted-foreground">
							<span class="font-medium">{formatPaymentFrequency(financing.paymentFrequency)}</span>
							<span aria-hidden="true">•</span>
							<span>{financing.financingType === 'loan' ? 'Loan' : 'Lease'} Payment</span>
							{#if financing.apr && financing.apr > 0}
								<span aria-hidden="true">•</span>
								<span>{financing.apr}% APR</span>
							{/if}
						</div>
					</div>

					<div
						class="rounded-full bg-chart-2/10 p-2 sm:p-3 flex-shrink-0 lg:hidden"
						aria-hidden="true"
					>
						<Calendar class="h-5 w-5 sm:h-6 sm:w-6 text-chart-2" />
					</div>
				</div>

				{#if isOwner && (recordPaymentHref || (onChangePayment && financing.financingType === 'loan'))}
					<div class="flex flex-wrap gap-2">
						{#if recordPaymentHref}
							<Button href={recordPaymentHref} class="w-full sm:w-auto">
								<CreditCard class="h-4 w-4 mr-2" />
								Record Payment
							</Button>
						{/if}
						{#if onChangePayment && financing.financingType === 'loan'}
							<Button variant="outline" class="w-full sm:w-auto" onclick={onChangePayment}>
								<ArrowRightLeft class="h-4 w-4 mr-2" />
								Change Payment
							</Button>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Right: Progress Summary -->
			<div class="space-y-4 lg:border-l lg:pl-6 border-border">
				<!-- Progress Bar -->
				<div class="space-y-2">
					<div class="flex justify-between items-center">
						<span class="text-sm font-medium text-muted-foreground">Payment Progress</span>
						<!-- text-foreground, NOT the chart color: text-chart-1 (#f54900) on white is
						     only 3.59:1 and chart-2 3.66:1 — both fail WCAG AA for this text. The
						     colored Progress bar below carries the progress signal; the number just
						     needs to be legible. (Same text-on-chart-color class as cycle 187/188.) -->
						<span class="text-lg font-bold text-foreground">
							{Math.round(progressPercentage)}%
						</span>
					</div>
					<div>
						<Progress
							value={progressPercentage}
							max={100}
							class="h-3 {progressIndicatorClass}"
							aria-label="Payment progress"
						/>
					</div>
				</div>

				<!-- Balance Stats -->
				<div class="grid grid-cols-3 gap-3 text-center">
					<div>
						<p class="text-xs text-muted-foreground">Original</p>
						<p class="text-sm sm:text-base font-semibold">
							{formatCurrency(financing.originalAmount)}
						</p>
					</div>
					<div>
						<p class="text-xs text-muted-foreground">Paid</p>
						<!-- text-foreground, NOT text-chart-2: #009689 on white is 3.66:1 (fails WCAG
						     AA). The "Paid" label above already identifies it; same class as cycle 187/188. -->
						<p class="text-sm sm:text-base font-semibold text-foreground">
							{formatCurrency(amountPaid)}
						</p>
					</div>
					<div>
						<p class="text-xs text-muted-foreground">Remaining</p>
						<p class="text-sm sm:text-base font-semibold">
							{formatCurrency(financing.computedBalance ?? 0)}
						</p>
					</div>
				</div>
			</div>
		</div>
	</CardContent>
</Card>
