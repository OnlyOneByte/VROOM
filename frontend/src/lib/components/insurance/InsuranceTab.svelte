<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { routes, paramRoutes } from '#lib/routes.ts';
	import { gotoWithQuery } from '#lib/utils/navigation.ts';
	import { Shield, Plus } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { insuranceApi } from '#lib/services/insurance-api.ts';
	import { logLoadFailure, userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { capitalize, formatCurrency, formatDate } from '#lib/utils/formatters.ts';
	import {
		CLAIM_STATUS_LABELS,
		getDaysRemaining,
		groupPoliciesByActive,
		splitTermsByToday
	} from '#lib/utils/insurance.ts';
	import { cn } from '#lib/utils.js';
	import type { InsuranceClaim, InsurancePolicy, InsuranceTerm } from '#lib/types/index.ts';

	interface Props {
		vehicleId: string;
		readOnly?: boolean;
	}

	let { vehicleId, readOnly = false }: Props = $props();

	let policies = $state<InsurancePolicy[]>([]);
	let claims = $state<InsuranceClaim[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let claimsError = $state<string | null>(null);
	let claimsLoading = $state(true);
	let showOtherTerms = $state(false);

	let returnTo = $derived(`${resolve(paramRoutes.vehicle, { id: vehicleId })}?tab=insurance`);
	let ordered = $derived.by(() => {
		const { active, inactive } = groupPoliciesByActive(policies);
		return [...active, ...inactive];
	});
	let termsByPolicy = $derived(new Map(policies.map(p => [p.id, splitTermsByToday(p.terms)])));
	let otherTerms = $derived(
		ordered.flatMap(policy =>
			(termsByPolicy.get(policy.id)?.others ?? []).map(term => ({ policy, term }))
		)
	);

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		isLoading = true;
		error = null;
		try {
			policies = await insuranceApi.getPoliciesForVehicle(vehicleId);
		} catch (err) {
			error = userFacingErrorMessage(err);
			logLoadFailure(err, "Couldn't load insurance policies");
		} finally {
			isLoading = false;
		}
		if (!error) await loadClaims();
	}

	async function loadClaims() {
		claimsLoading = true;
		try {
			const perPolicy = await Promise.all(policies.map(p => insuranceApi.getClaims(p.id)));
			claims = perPolicy
				.flat()
				.filter(c => !c.vehicleId || c.vehicleId === vehicleId)
				.sort((a, b) => b.claimDate.localeCompare(a.claimDate));
			claimsError = null;
		} catch (err) {
			claims = [];
			claimsError = userFacingErrorMessage(err);
			logLoadFailure(err, "Couldn't load this car's claims");
		} finally {
			claimsLoading = false;
		}
	}

	function handleAddPolicy() {
		gotoWithQuery(resolve(routes.insuranceNew), { vehicleId, returnTo });
	}

	function policyHref(policy: InsurancePolicy): string {
		const edit = resolve(paramRoutes.insurancePolicyEdit, { id: policy.id });
		return `${edit}?returnTo=${encodeURIComponent(returnTo)}`;
	}

	function coverageText(term: InsuranceTerm | undefined): string {
		return [
			term?.coverageDescription?.trim() || null,
			term?.deductibleAmount ? `${formatCurrency(term.deductibleAmount)} deductible` : null
		]
			.filter(Boolean)
			.join(' · ');
	}

	function statusTone(days: number): string {
		if (days <= 7) return 'text-destructive';
		if (days <= 30) return 'text-warning';
		return 'text-muted-foreground';
	}

	function policyMeta(policy: InsurancePolicy, term: InsuranceTerm | undefined): string {
		return [
			term?.policyNumber ? `#${term.policyNumber}` : null,
			term ? `${formatDate(term.startDate)} – ${formatDate(term.endDate)}` : 'No terms yet',
			policy.isActive ? null : 'Inactive'
		]
			.filter(Boolean)
			.join(' · ');
	}

	function renewalText(term: InsuranceTerm): string {
		const days = getDaysRemaining(term.endDate);
		if (days < 0) return `Expired ${formatDate(term.endDate)}`;
		if (days === 0) return 'Renews today';
		if (days === 1) return 'Renews tomorrow';
		return `Renews in ${days} days`;
	}

	function costText(term: InsuranceTerm | undefined): string | null {
		if (term?.totalCost) return formatCurrency(term.totalCost);
		if (term?.monthlyCost) return `${formatCurrency(term.monthlyCost)}/mo`;
		return null;
	}

	function claimTitle(claim: InsuranceClaim): string {
		return claim.description?.trim() || capitalize(claim.claimType);
	}

	function claimMeta(claim: InsuranceClaim): string {
		return [
			formatDate(claim.claimDate),
			CLAIM_STATUS_LABELS[claim.status],
			claim.description?.trim() ? capitalize(claim.claimType) : null
		]
			.filter(Boolean)
			.join(' · ');
	}
</script>

{#if isLoading}
	<div class="space-y-3" aria-hidden="true" data-testid="insurance-tab-loading">
		<Skeleton class="h-5 w-40" />
		<Skeleton class="h-32 w-full" />
	</div>
{:else if error}
	<LoadErrorCard title="Couldn't load this car's insurance" message={error} onRetry={loadData} />
{:else if policies.length === 0}
	<EmptyState level={2}>
		{#snippet icon()}
			<Shield class="mb-4 h-12 w-12 text-muted-foreground" />
		{/snippet}
		{#snippet title()}No insurance policies{/snippet}
		{#snippet description()}
			{#if readOnly}
				This vehicle has no insurance policies.
			{:else}
				Add your first insurance policy to track coverage, costs, and documents.
			{/if}
		{/snippet}
		{#snippet action()}
			{#if !readOnly}
				<Button onclick={handleAddPolicy}>
					<Plus class="mr-2 h-4 w-4" />
					Add policy
				</Button>
			{/if}
		{/snippet}
	</EmptyState>
{:else}
	<div class="grid gap-8 lg:grid-cols-2">
		<section aria-labelledby="vehicle-policies-heading" class="space-y-3">
			<div class="flex min-h-10 items-center justify-between gap-3">
				<h2 class="text-lg font-semibold" id="vehicle-policies-heading">Policies</h2>
				{#if !readOnly}
					<Button variant="outline" onclick={handleAddPolicy}>
						<Plus class="mr-2 h-4 w-4" />
						Add policy
					</Button>
				{/if}
			</div>
			<ul class="divide-y border-y">
				{#each ordered as policy (policy.id)}
					{@const split = termsByPolicy.get(policy.id)}
					{@const term = split?.shown}
					{@const cost = costText(term)}
					{@const days = term ? getDaysRemaining(term.endDate) : null}
					{@const coverage = coverageText(term)}
					<li class="flex flex-col">
						<svelte:element
							this={readOnly ? 'div' : 'a'}
							href={readOnly ? undefined : policyHref(policy)}
							class={cn(
								'flex min-w-0 flex-1 items-center justify-between gap-4 py-3',
								!readOnly &&
									'-mx-2 rounded-md px-2 outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50'
							)}
						>
							<span class="min-w-0">
								<span class="block font-semibold break-words text-foreground">
									{policy.company}
								</span>
								<span class="block text-sm text-muted-foreground">{policyMeta(policy, term)}</span>
								{#if coverage}
									<span class="block text-sm text-muted-foreground">{coverage}</span>
								{/if}
							</span>
							<span class="max-w-[40%] shrink-0 text-right">
								{#if cost}
									<span class="block font-semibold whitespace-nowrap tabular-nums">{cost}</span>
								{/if}
								{#if term && days !== null && policy.isActive}
									{#if split?.startsLater && term}
										<span class="block text-sm text-muted-foreground">
											Starts {formatDate(term.startDate)}
										</span>
									{:else if split?.upcoming && days >= 0}
										<span class="block text-sm text-muted-foreground">
											Next term from {formatDate(split.upcoming.startDate)}
										</span>
									{:else}
										<span class={cn('block text-sm', statusTone(days))}>{renewalText(term)}</span>
									{/if}
								{/if}
							</span>
						</svelte:element>
						{#if policy.notes?.trim()}
							<p class="-mt-1 pb-3 text-sm break-words text-muted-foreground">{policy.notes}</p>
						{/if}
					</li>
				{/each}
			</ul>
			{#if otherTerms.length > 0}
				<Button
					variant="ghost"
					class="-ml-3"
					aria-expanded={showOtherTerms}
					aria-controls="vehicle-other-terms"
					onclick={() => (showOtherTerms = !showOtherTerms)}
				>
					{showOtherTerms
						? 'Hide other terms'
						: `Show ${otherTerms.length} other ${otherTerms.length === 1 ? 'term' : 'terms'}`}
				</Button>
				{#if showOtherTerms}
					<ul class="divide-y border-y" id="vehicle-other-terms" aria-label="Other terms">
						{#each otherTerms as { policy, term } (term.id)}
							{@const cost = costText(term)}
							<li class="flex items-center justify-between gap-4 py-3">
								<span class="min-w-0">
									<span class="block font-semibold break-words text-foreground">
										{policy.company}
									</span>
									<span class="block text-sm text-muted-foreground">
										{policyMeta({ ...policy, isActive: true }, term)}
									</span>
								</span>
								{#if cost}
									<span class="shrink-0 font-semibold tabular-nums">{cost}</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
			{#if !readOnly}
				<p class="text-sm text-muted-foreground">
					Documents, filing a claim and renewals are on the
					<a
						class="font-semibold text-accent-ink underline-offset-4 hover:underline"
						href={resolve(routes.insurance)}
					>
						Insurance page
					</a>.
				</p>
			{/if}
		</section>

		<section aria-labelledby="vehicle-claims-heading" class="space-y-3">
			<h2 class="flex min-h-10 items-center text-lg font-semibold" id="vehicle-claims-heading">
				Claims
			</h2>
			{#if claimsError}
				<LoadErrorCard
					compact
					title="Couldn't load this car's claims"
					message={claimsError}
					onRetry={loadClaims}
				/>
			{:else if claimsLoading}
				<div aria-hidden="true" data-testid="claims-loading">
					<Skeleton class="h-14 w-full" />
				</div>
			{:else if claims.length === 0}
				<p class="border-y py-3 text-sm text-muted-foreground">No claims for this car.</p>
			{:else}
				<ul class="divide-y border-y">
					{#each claims as claim (claim.id)}
						<li class="flex items-center justify-between gap-4 py-3">
							<span class="min-w-0">
								<span class="block font-semibold break-words text-foreground">
									{claimTitle(claim)}
								</span>
								<span class="block text-sm text-muted-foreground">{claimMeta(claim)}</span>
							</span>
							{#if claim.payoutAmount != null}
								<span class="shrink-0 font-semibold tabular-nums">
									{formatCurrency(claim.payoutAmount)}
								</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
{/if}
