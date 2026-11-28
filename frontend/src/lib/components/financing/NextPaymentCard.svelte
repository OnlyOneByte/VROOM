<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.ts';
	import { formatCurrency, formatDateWith, formatNumberUpTo } from '#lib/utils/formatters.ts';
	import {
		calculateNextPaymentDate,
		remainingBalance,
		calculateDaysUntil,
		calculateMinimumPayment,
		formatPaymentFrequency
	} from '#lib/utils/financing-calculations.ts';
	import type { VehicleFinancing, DerivedPaymentEntry } from '#lib/types/index.ts';

	interface Props {
		financing: VehicleFinancing;
		lastPayment?: DerivedPaymentEntry;
		paymentsLoaded?: boolean;
		recordPaymentHref?: string;
		showProgress?: boolean;
		onChangePayment?: () => void;
		isOwner?: boolean;
	}

	let {
		financing,
		lastPayment,
		paymentsLoaded = true,
		recordPaymentHref,
		showProgress = true,
		onChangePayment,
		isOwner = true
	}: Props = $props();

	let minimumPayment = $derived(calculateMinimumPayment(financing));

	let nextPaymentDate = $derived.by(() => {
		try {
			const lastPaymentDate = lastPayment ? new Date(lastPayment.expense.date) : undefined;
			return calculateNextPaymentDate(financing, lastPaymentDate, !paymentsLoaded);
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

	let formattedDueDate = $derived(
		formatDateWith(nextPaymentDate, { month: 'short', day: 'numeric', year: 'numeric' })
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

	let pressing = $derived(daysUntilPayment <= 3);
	let isLoan = $derived(financing.financingType === 'loan');
	let hasRate = $derived(isLoan && !!financing.apr && financing.apr > 0);
	let balance = $derived(remainingBalance(financing));

	let split = $derived.by(() => {
		if (!hasRate || financing.paymentFrequency !== 'monthly') return null;
		const interest = Math.round(balance * ((financing.apr ?? 0) / 100 / 12) * 100) / 100;
		const principal = Math.max(0, Math.min(balance, financing.paymentAmount - interest));
		return { principal, interest };
	});

	let showMinimum = $derived(
		minimumPayment !== null && financing.paymentAmount > minimumPayment + 0.01
	);

	let terms = $derived(
		[
			hasRate ? `${formatNumberUpTo(financing.apr ?? 0, 2)}% APR` : null,
			financing.paymentFrequency === 'monthly'
				? null
				: formatPaymentFrequency(financing.paymentFrequency),
			financing.termMonths ? `${financing.termMonths} months` : null
		]
			.filter(Boolean)
			.join(' · ')
	);

	let amountPaid = $derived(Math.max(0, financing.originalAmount - balance));
	let progressPercentage = $derived(
		financing.originalAmount > 0 ? Math.min(100, (amountPaid / financing.originalAmount) * 100) : 0
	);
	let canPlan = $derived(isOwner && !!onChangePayment && isLoan);
</script>

<section aria-labelledby="next-payment-heading" class="space-y-1">
	<div class="flex items-baseline justify-between gap-3">
		<h3 class="text-base font-semibold" id="next-payment-heading">Next payment</h3>
		{#if isOwner && recordPaymentHref}
			<Button
				href={recordPaymentHref}
				variant="ghost"
				size="sm"
				class="-my-1 -mr-2 font-semibold text-accent-ink"
			>
				Record payment
			</Button>
		{/if}
	</div>
	<ul class="divide-y divide-border">
		<li class="flex items-center justify-between gap-4 py-3">
			<div class="min-w-0">
				<p class="font-semibold">
					<time datetime={nextPaymentDate.toISOString()}>{formattedDueDate}</time>
					<span
						class="ml-1 text-sm font-normal {pressing
							? 'text-destructive'
							: 'text-muted-foreground'}"
						role="status"
						aria-live="polite"
					>
						{countdownText}
					</span>
				</p>
				{#if split}
					<p class="text-sm text-muted-foreground">
						{formatCurrency(split.principal)} principal · {formatCurrency(split.interest)} interest
					</p>
				{/if}
			</div>
			<div class="shrink-0 text-right">
				<p class="font-semibold tabular-nums" aria-label="Payment amount">
					{formatCurrency(financing.paymentAmount)}
				</p>
				{#if showMinimum}
					<p class="text-xs font-semibold text-muted-foreground tabular-nums">
						Min: {formatCurrency(minimumPayment ?? 0)}
					</p>
				{/if}
			</div>
		</li>
		<li class="flex items-center justify-between gap-4 py-3">
			<p class="font-semibold">{isLoan ? 'Loan' : 'Lease'} terms</p>
			<p class="text-right text-sm text-muted-foreground">{terms}</p>
		</li>
		{#if showProgress}
			<li class="flex items-center justify-between gap-4 py-3">
				<div class="min-w-0">
					<p class="font-semibold">Paid so far</p>
					<p class="text-sm text-muted-foreground">
						{formatCurrency(amountPaid)} of {formatCurrency(financing.originalAmount)} · {formatCurrency(
							balance
						)} left
					</p>
				</div>
				<p
					class="shrink-0 font-semibold tabular-nums"
					role="progressbar"
					aria-label="Payment progress"
					aria-valuenow={progressPercentage}
					aria-valuemin={0}
					aria-valuemax={100}
				>
					{Math.round(progressPercentage)}%
				</p>
			</li>
		{/if}
		{#if canPlan}
			<li class="flex items-center justify-between gap-4 py-3">
				<div class="min-w-0">
					<p class="font-semibold">Paying extra?</p>
					<p class="text-sm text-muted-foreground">
						See how a bigger payment changes the payoff date
					</p>
				</div>
				<Button variant="outline" class="shrink-0" onclick={onChangePayment}>
					Payment planner
				</Button>
			</li>
		{/if}
	</ul>
</section>
