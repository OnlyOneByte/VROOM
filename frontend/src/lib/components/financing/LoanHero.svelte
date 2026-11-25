<script lang="ts">
	import HeroFigure from '#lib/components/common/hero-figure.svelte';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import type { DerivedPaymentEntry, VehicleFinancing } from '#lib/types/index.ts';
	import { currentLocale, formatCurrency } from '#lib/utils/formatters.ts';
	import { remainingBalance } from '#lib/utils/financing-calculations.ts';

	interface Props {
		financing: VehicleFinancing;
		payments: DerivedPaymentEntry[];
		paymentsLoaded: boolean;
		paymentsLoading?: boolean;
		payoffDate: Date;
	}

	let {
		financing,
		payments,
		paymentsLoaded,
		paymentsLoading = false,
		payoffDate
	}: Props = $props();

	const PERIOD: Record<VehicleFinancing['paymentFrequency'], string> = {
		monthly: 'a month',
		'bi-weekly': 'every two weeks',
		weekly: 'a week',
		custom: 'per payment'
	};

	let balance = $derived(Math.max(0, remainingBalance(financing)));
	let principalPaid = $derived(payments.reduce((sum, p) => sum + (p.principalAmount || 0), 0));
	let interestPaid = $derived(payments.reduce((sum, p) => sum + (p.interestAmount || 0), 0));
	let made = $derived(payments.length);
	const MAX_MONTHS = 1200;

	function monthlyInterestLeft(principal: number, apr: number, payment: number): number | null {
		const rate = apr / 1200;
		let left = principal;
		let total = 0;
		for (let month = 0; left > 0.005 && month < MAX_MONTHS; month++) {
			const interest = left * rate;
			if (payment <= interest) return null;
			total += interest;
			left -= Math.min(payment - interest, left);
		}
		return left > 0.005 ? null : total;
	}

	let interestLeft = $derived(
		paymentsLoaded && financing.paymentFrequency === 'monthly' && (financing.apr ?? 0) > 0
			? monthlyInterestLeft(balance, financing.apr ?? 0, financing.paymentAmount)
			: null
	);
	let payoff = $derived(
		new Intl.DateTimeFormat(currentLocale(), { month: 'short', year: 'numeric' }).format(payoffDate)
	);

	let split = $derived(
		[
			{ key: 'principal', label: 'Principal paid', amount: principalPaid, bar: 'bg-chart-1' },
			{ key: 'interest', label: 'Interest paid', amount: interestPaid, bar: 'bg-chart-2' },
			{ key: 'left', label: 'Left to pay', amount: balance, bar: 'bg-muted-foreground/40' }
		].filter(part => part.amount > 0)
	);
	let splitTotal = $derived(split.reduce((sum, part) => sum + part.amount, 0));
</script>

<section
	class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-end lg:gap-12"
	aria-label="Loan left to pay"
	data-testid="loan-hero"
>
	<div class="space-y-3">
		<HeroFigure
			label="Loan left to pay{financing.provider ? ` · ${financing.provider}` : ''}"
			value={formatCurrency(balance, undefined, 0)}
		/>
		{#if !paymentsLoading}
			<p class="max-w-xl text-base leading-relaxed lg:text-lg" data-testid="loan-sentence">
				{#if balance === 0}
					{#if paymentsLoaded}<strong>{made}</strong> payments made.{/if} The loan is paid off.
				{:else}
					{#if paymentsLoaded}<strong>{made} of {financing.termMonths}</strong> payments made.{/if} At
					{formatCurrency(financing.paymentAmount)}
					{PERIOD[financing.paymentFrequency]} it's paid off in
					<strong>{payoff}</strong>{#if interestLeft !== null}, with <strong>
							{formatCurrency(interestLeft, undefined, 0)}
						</strong> of interest still to go{/if}.
				{/if}
			</p>
		{:else}
			<div class="space-y-2" aria-hidden="true">
				<Skeleton class="h-5 w-full max-w-md" />
				<Skeleton class="h-5 w-2/3 max-w-xs" />
			</div>
		{/if}
	</div>

	{#if paymentsLoaded && splitTotal > 0}
		<div class="space-y-3">
			<ul class="flex flex-wrap gap-x-6 gap-y-2">
				{#each split as part (part.key)}
					<li class="min-w-0">
						<span class="flex items-center gap-1.5 text-sm text-muted-foreground">
							<span class="h-2 w-2 shrink-0 rounded-full {part.bar}" aria-hidden="true"></span>
							{part.label}
						</span>
						<span class="block text-xl font-semibold tabular-nums">
							{formatCurrency(part.amount, undefined, 0)}
						</span>
					</li>
				{/each}
			</ul>
			<div class="flex h-2 gap-1" aria-hidden="true">
				{#each split as part (part.key)}
					<div
						class="rounded-full {part.bar}"
						style:width="{(part.amount / splitTotal) * 100}%"
						data-part={part.key}
					></div>
				{/each}
			</div>
		</div>
	{/if}
</section>
