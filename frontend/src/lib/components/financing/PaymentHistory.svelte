<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.ts';
	import { formatCurrency, formatDate } from '#lib/utils/formatters.ts';
	import type { DerivedPaymentEntry, VehicleFinancing } from '#lib/types/index.ts';

	interface Props {
		payments: DerivedPaymentEntry[];
		financing: VehicleFinancing;
	}

	let { payments, financing }: Props = $props();

	const FIRST_ROWS = 6;

	let showAll = $state(false);

	let sortedPayments = $derived(
		[...payments].sort(
			(a, b) => new Date(b.expense.date).getTime() - new Date(a.expense.date).getTime()
		)
	);
	let shown = $derived(showAll ? sortedPayments : sortedPayments.slice(0, FIRST_ROWS));
	let hidden = $derived(sortedPayments.length - shown.length);
	let splits = $derived(financing.financingType === 'loan' && !!financing.apr && financing.apr > 0);
</script>

<section aria-labelledby="payment-history-heading" class="space-y-1">
	<div class="flex items-baseline justify-between gap-3">
		<h3 class="text-base font-semibold" id="payment-history-heading">Payment history</h3>
		{#if sortedPayments.length > 0}
			<p class="text-sm text-muted-foreground" aria-live="polite">
				{sortedPayments.length} payment{sortedPayments.length !== 1 ? 's' : ''} recorded
			</p>
		{/if}
	</div>
	{#if sortedPayments.length === 0}
		<p class="py-3 text-muted-foreground" role="status">
			No payments recorded yet. Record a payment to track your progress.
		</p>
	{:else}
		<ul class="divide-y divide-border" aria-labelledby="payment-history-heading">
			{#each shown as payment (payment.expense.id)}
				{@const date = formatDate(new Date(payment.expense.date))}
				<li
					class="flex items-center justify-between gap-4 py-3"
					aria-label="Payment {payment.paymentNumber} on {date}"
				>
					<div class="min-w-0">
						<p class="font-semibold">
							<span aria-label="Payment number {payment.paymentNumber}">
								#{payment.paymentNumber}
							</span>
							· <time datetime={new Date(payment.expense.date).toISOString()}>{date}</time>
							{#if payment.paymentType === 'extra'}
								<span class="ml-1 text-sm font-normal text-muted-foreground">Extra payment</span>
							{/if}
						</p>
						{#if splits}
							<p class="text-sm text-muted-foreground" role="group" aria-label="Payment breakdown">
								<span>{formatCurrency(payment.principalAmount)}</span> principal ·
								<span>{formatCurrency(payment.interestAmount)}</span> interest
							</p>
						{/if}
					</div>
					<div class="shrink-0 text-right">
						<p class="font-semibold tabular-nums" aria-label="Payment amount">
							{formatCurrency(payment.expense.amount)}
						</p>
						<p class="text-xs font-semibold text-muted-foreground tabular-nums">
							<span>{formatCurrency(payment.remainingBalance)}</span> left
						</p>
					</div>
				</li>
			{/each}
		</ul>
		{#if hidden > 0 || showAll}
			<Button variant="ghost" class="-ml-3" onclick={() => (showAll = !showAll)}>
				{showAll ? 'Show fewer' : `Show all ${sortedPayments.length}`}
			</Button>
		{/if}
	{/if}
</section>
