<script lang="ts">
	import PolicyTermCard from './PolicyTermCard.svelte';
	import TermForm from './form/TermForm.svelte';
	import { sortTermsByEndDateDesc } from '$lib/utils/insurance';
	import type { PolicyTerm, Vehicle, TermCoverageRow } from '$lib/types';

	interface Props {
		terms: PolicyTerm[];
		policyId: string;
		vehicles?: Vehicle[];
		termVehicleCoverage?: TermCoverageRow[];
		onRefresh: () => Promise<void>;
		onDeleteTerm?: (_term: PolicyTerm) => void;
	}

	let {
		terms,
		policyId,
		vehicles = [],
		termVehicleCoverage = [],
		onRefresh,
		onDeleteTerm
	}: Props = $props();

	let sortedTerms = $derived(sortTermsByEndDateDesc(terms));

	let showTermForm = $state(false);
	let editingTerm = $state<PolicyTerm | null>(null);

	function handleEdit(term: PolicyTerm) {
		editingTerm = term;
		showTermForm = true;
	}

	async function handleTermSuccess() {
		showTermForm = false;
		editingTerm = null;
		await onRefresh();
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
				<PolicyTermCard
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

<TermForm
	bind:open={showTermForm}
	{policyId}
	term={editingTerm}
	previousTerm={null}
	{vehicles}
	{termVehicleCoverage}
	onSuccess={handleTermSuccess}
/>
