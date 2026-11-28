<script lang="ts">
	import { resolve } from '$app/paths';
	import { paramRoutes } from '#lib/routes.ts';
	import type { FinancingResponse } from '#lib/types/index.ts';
	import { formatCurrency, formatNumber } from '#lib/utils/formatters.ts';

	let { financing }: { financing: FinancingResponse } = $props();

	let financed = $derived(financing.vehicleDetails.filter(v => v.financingType !== 'own'));
	let owned = $derived(financing.vehicleDetails.length - financed.length);
	let whole = (v: number) => formatCurrency(v, undefined, 0);

	let kind = $derived.by(() => {
		const { loanCount, leaseCount } = financing.summary;
		if (leaseCount === 0) return loanCount === 1 ? 'one loan' : `${loanCount} loans`;
		if (loanCount === 0) return leaseCount === 1 ? 'one lease' : `${leaseCount} leases`;
		return `${loanCount + leaseCount} loans and leases`;
	});

	let ownedText = $derived(
		owned === 0
			? ''
			: financed.length === 0
				? owned === 1
					? 'Your car is owned outright.'
					: `All ${owned} cars are owned outright.`
				: `The other ${owned === 1 ? 'car is' : `${owned} cars are`} owned outright.`
	);

	function meta(v: FinancingResponse['vehicleDetails'][number]): string {
		const left = `${v.monthsRemaining} ${v.monthsRemaining === 1 ? 'payment' : 'payments'} to go`;
		return [
			v.financingType === 'lease' ? 'Lease' : 'Loan',
			v.financingType === 'loan' && v.apr != null ? `${formatNumber(v.apr, 1)}% APR` : null,
			left
		]
			.filter(Boolean)
			.join(' · ');
	}
</script>

{#if financing.vehicleDetails.length > 0}
	<section aria-labelledby="cross-loans-title" class="space-y-3">
		<h2 class="text-base font-semibold" id="cross-loans-title">Loans</h2>
		<p class="max-w-xl text-muted-foreground">
			{#if financed.length > 0}
				You pay <strong class="text-foreground">
					{formatCurrency(financing.summary.totalMonthlyPayments)} a month
				</strong>
				on {kind}, with <strong class="text-foreground">
					{whole(financing.summary.remainingBalance)}
				</strong> left.
			{/if}
			{ownedText}
		</p>
		{#if financed.length > 0}
			<ul class="divide-y divide-border" aria-labelledby="cross-loans-title">
				{#each financed as v (v.vehicleId)}
					<li class="flex items-center justify-between gap-4 py-3">
						<div class="min-w-0">
							<a
								href={resolve(paramRoutes.vehicle, { id: v.vehicleId })}
								class="block rounded-sm font-semibold break-words text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
							>
								{v.vehicleName}
							</a>
							<p class="text-sm text-muted-foreground">{meta(v)}</p>
						</div>
						<div class="shrink-0 text-right">
							<p class="font-semibold tabular-nums">{formatCurrency(v.monthlyPayment)}/mo</p>
							{#if v.remainingBalance > 0}
								<p class="text-xs font-semibold text-muted-foreground tabular-nums">
									{whole(v.remainingBalance)} left
								</p>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}
