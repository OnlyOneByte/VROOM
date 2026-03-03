<script lang="ts">
	import { Pencil, Calendar } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import TermForm from './TermForm.svelte';
	import { sortTermsByEndDateDesc } from '$lib/utils/insurance';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import type { PolicyTerm, Vehicle, TermCoverageRow } from '$lib/types';

	interface Props {
		terms: PolicyTerm[];
		policyId: string;
		vehicles?: Vehicle[];
		termVehicleCoverage?: TermCoverageRow[];
		onRefresh: () => Promise<void>;
	}

	let { terms, policyId, vehicles = [], termVehicleCoverage = [], onRefresh }: Props = $props();

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
</script>

<div class="space-y-3">
	<h5 class="text-sm font-medium text-foreground">Past Terms</h5>

	{#if sortedTerms.length === 0}
		<p class="text-sm text-muted-foreground">No past terms.</p>
	{:else}
		<div class="space-y-2">
			{#each sortedTerms as t (t.id)}
				<div class="rounded-md border border-border p-3">
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-2">
								<div class="flex items-center gap-1 text-xs text-muted-foreground">
									<Calendar class="h-3 w-3" />
									{formatDate(t.startDate)} – {formatDate(t.endDate)}
								</div>
							</div>

							<div class="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
								{#if t.financeDetails.totalCost !== undefined}
									<span>Total: {formatCurrency(t.financeDetails.totalCost)}</span>
								{/if}
								{#if t.policyDetails.policyNumber}
									<span>#{t.policyDetails.policyNumber}</span>
								{/if}
							</div>

							{#if termVehicleCoverage.filter(tc => tc.termId === t.id).length > 0 && vehicles.length > 0}
								<p class="mt-1 text-xs text-muted-foreground">
									{termVehicleCoverage
										.filter(tc => tc.termId === t.id)
										.map(tv => {
											const v = vehicles.find(vh => vh.id === tv.vehicleId);
											return v ? v.nickname || `${v.year} ${v.make} ${v.model}` : tv.vehicleId;
										})
										.join(', ')}
								</p>
							{/if}
						</div>

						<div class="flex items-center gap-0.5 shrink-0">
							<Button
								variant="ghost"
								size="icon"
								class="h-7 w-7"
								onclick={() => handleEdit(t)}
								title="Edit term"
							>
								<Pencil class="h-3 w-3" />
							</Button>
						</div>
					</div>
				</div>
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
