<script lang="ts">
	import { resolve } from '$app/paths';
	import { routes } from '#lib/routes.ts';
	import type { InsuranceResponse } from '#lib/types/index.ts';
	import { formatCurrency } from '#lib/utils/formatters.ts';

	let { insurance }: { insurance: InsuranceResponse } = $props();

	let cars = $derived(new Set(insurance.vehicleDetails.map(v => v.vehicleId)).size);
	let whole = (v: number) => formatCurrency(v, undefined, 0);

	function meta(v: InsuranceResponse['vehicleDetails'][number]): string {
		return [
			v.vehicleName,
			`${whole(v.annualPremium)} a year`,
			v.deductible != null ? `${whole(v.deductible)} deductible` : null,
			v.coverageType
		]
			.filter(Boolean)
			.join(' · ');
	}
</script>

<section aria-labelledby="cross-insurance-title" class="space-y-3">
	<div class="flex items-baseline justify-between gap-3">
		<h2 class="text-base font-semibold" id="cross-insurance-title">Insurance</h2>
		<a
			href={resolve(routes.insurance)}
			class="-my-1 -mr-2 inline-flex min-h-7 items-center rounded-sm px-2 text-sm font-semibold text-accent-ink outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
		>
			All policies
		</a>
	</div>
	<p class="max-w-xl text-muted-foreground">
		{#if insurance.vehicleDetails.length > 0}
			Insurance is <strong class="text-foreground">
				{formatCurrency(insurance.summary.totalMonthlyPremiums)} a month
			</strong>
			across {cars === 1 ? 'one car' : `${cars} cars`}, {whole(insurance.summary.totalAnnualPremiums)} a
			year.
		{:else}
			No car here has an active insurance policy.
		{/if}
	</p>
	{#if insurance.vehicleDetails.length > 0}
		<ul class="divide-y divide-border" aria-labelledby="cross-insurance-title">
			{#each insurance.vehicleDetails as v, i (`${v.vehicleId}-${i}`)}
				<li class="flex items-center justify-between gap-4 py-3">
					<div class="min-w-0">
						<p class="font-semibold break-words">{v.carrier}</p>
						<p class="text-sm text-muted-foreground">{meta(v)}</p>
					</div>
					<p class="shrink-0 font-semibold tabular-nums">{formatCurrency(v.monthlyPremium)}/mo</p>
				</li>
			{/each}
		</ul>
	{/if}
</section>
