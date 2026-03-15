<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { paramRoutes } from '$lib/routes';
	import InsuranceTermCard from './PolicyTermCard.svelte';
	import { sortTermsByEndDateDesc } from '$lib/utils/insurance';
	import type { InsuranceTerm, Vehicle, TermCoverageRow } from '$lib/types';

	interface Props {
		terms: InsuranceTerm[];
		policyId: string;
		vehicles?: Vehicle[];
		termVehicleCoverage?: TermCoverageRow[];
		onRefresh?: () => Promise<void>;
		onDeleteTerm?: (_term: InsuranceTerm) => void;
	}

	let {
		terms,
		policyId,
		vehicles = [],
		termVehicleCoverage = [],
		onRefresh: _onRefresh,
		onDeleteTerm
	}: Props = $props();

	let sortedTerms = $derived(sortTermsByEndDateDesc(terms));

	function handleEdit(term: InsuranceTerm) {
		goto(resolve(paramRoutes.insuranceTermEdit, { id: policyId, termId: term.id }));
	}

	function getTermVehicleNames(termId: string): string[] {
		if (!termVehicleCoverage || vehicles.length === 0) return [];
		return termVehicleCoverage
			.filter(tc => tc.termId === termId)
			.map(tv => {
				const v = vehicles.find(vh => vh.id === tv.vehicleId);
				return v ? v.nickname || `${v.year} ${v.make} ${v.model}` : tv.vehicleId;
			});
	}
</script>

<div class="space-y-3">
	<h5 class="text-sm font-medium text-foreground">Past Terms</h5>

	{#if sortedTerms.length === 0}
		<p class="text-sm text-muted-foreground">No past terms.</p>
	{:else}
		<div class="space-y-2">
			{#each sortedTerms as t (t.id)}
				<InsuranceTermCard
					term={t}
					isCurrent={false}
					vehicleNames={getTermVehicleNames(t.id)}
					onEdit={handleEdit}
					onDelete={onDeleteTerm}
				/>
			{/each}
		</div>
	{/if}
</div>
