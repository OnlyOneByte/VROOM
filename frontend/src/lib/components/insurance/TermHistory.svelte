<script lang="ts">
	import { Pencil, RefreshCw, Calendar } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import TermForm from './TermForm.svelte';
	import { sortTermsByEndDateDesc, getLatestTerm } from '$lib/utils/insurance';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import type { PolicyTerm } from '$lib/types';

	interface Props {
		terms: PolicyTerm[];
		policyId: string;
		onRefresh: () => Promise<void>;
	}

	let { terms, policyId, onRefresh }: Props = $props();

	let sortedTerms = $derived(sortTermsByEndDateDesc(terms));
	let latestTerm = $derived(getLatestTerm(terms));

	let showTermForm = $state(false);
	let editingTerm = $state<PolicyTerm | null>(null);
	let renewFromTerm = $state<PolicyTerm | null>(null);

	function handleEdit(term: PolicyTerm) {
		editingTerm = term;
		renewFromTerm = null;
		showTermForm = true;
	}

	function handleRenew() {
		editingTerm = null;
		renewFromTerm = latestTerm ?? null;
		showTermForm = true;
	}

	async function handleTermSuccess() {
		showTermForm = false;
		editingTerm = null;
		renewFromTerm = null;
		await onRefresh();
	}
</script>

<div class="space-y-3">
	<div class="flex items-center justify-between">
		<h5 class="text-sm font-medium text-foreground">Term History</h5>
		{#if latestTerm}
			<Button variant="outline" size="sm" class="h-7 text-xs" onclick={handleRenew}>
				<RefreshCw class="mr-1 h-3 w-3" />
				Renew
			</Button>
		{/if}
	</div>

	{#if sortedTerms.length === 0}
		<p class="text-sm text-muted-foreground">No terms recorded.</p>
	{:else}
		<div class="space-y-2">
			{#each sortedTerms as t, index (t.id)}
				{@const isLatest = index === 0}
				<div
					class="rounded-md border p-3 {isLatest
						? 'border-primary/30 bg-primary/5'
						: 'border-border'}"
				>
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-2">
								<div class="flex items-center gap-1 text-xs text-muted-foreground">
									<Calendar class="h-3 w-3" />
									{formatDate(t.startDate)} – {formatDate(t.endDate)}
								</div>
								{#if isLatest}
									<Badge variant="secondary" class="text-xs">Current</Badge>
								{/if}
							</div>

							<div class="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
								{#if t.financeDetails.totalCost !== undefined}
									<span>Total: {formatCurrency(t.financeDetails.totalCost)}</span>
								{/if}
								{#if t.financeDetails.monthlyCost !== undefined}
									<span>{formatCurrency(t.financeDetails.monthlyCost)}/mo</span>
								{/if}
								{#if t.policyDetails.policyNumber}
									<span>#{t.policyDetails.policyNumber}</span>
								{/if}
							</div>

							{#if t.policyDetails.coverageDescription}
								<p class="mt-1 text-xs text-muted-foreground truncate">
									{t.policyDetails.coverageDescription}
								</p>
							{/if}
						</div>

						<Button
							variant="ghost"
							size="sm"
							class="h-7 text-xs shrink-0"
							onclick={() => handleEdit(t)}
						>
							<Pencil class="mr-1 h-3 w-3" />
							Edit
						</Button>
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
	previousTerm={renewFromTerm}
	onSuccess={handleTermSuccess}
/>
