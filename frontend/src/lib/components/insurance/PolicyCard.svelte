<script lang="ts">
	import { ChevronDown, ChevronUp, Building2, Settings } from '@lucide/svelte';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import PolicyTermCard from './PolicyTermCard.svelte';
	import ExpirationAlert from './ExpirationAlert.svelte';
	import TermHistory from './TermHistory.svelte';
	import TermForm from './form/TermForm.svelte';
	import DocumentViewer from './DocumentViewer.svelte';
	import { getLatestTerm } from '$lib/utils/insurance';
	import { insuranceApi } from '$lib/services/insurance-api';
	import { handleErrorWithNotification } from '$lib/utils/error-handling';
	import type { InsurancePolicy, Vehicle } from '$lib/types';

	interface Props {
		policy: InsurancePolicy;
		vehicleNames?: string[];
		vehicles?: Vehicle[];
		autoEditTermId?: string | null;
		onEdit: (_policy: InsurancePolicy) => void;
		onDelete?: (_policyId: string) => void;
		onRefresh: () => Promise<void>;
	}

	let {
		policy,
		vehicleNames = [],
		vehicles = [],
		autoEditTermId = null,
		onEdit,
		onRefresh
	}: Props = $props();

	let expanded = $state(false);
	let latestTerm = $derived(getLatestTerm(policy.terms));
	let pastTerms = $derived(policy.terms.filter(t => t.id !== latestTerm?.id));

	let showTermForm = $state(false);
	let editingTerm = $state<import('$lib/types').PolicyTerm | null>(null);
	let renewFromTerm = $state<import('$lib/types').PolicyTerm | null>(null);
	let autoEditHandled = $state(false);

	// Auto-open term edit when deep-linked from an expense
	$effect(() => {
		if (autoEditTermId && !autoEditHandled) {
			autoEditHandled = true;
			const term = policy.terms.find(t => t.id === autoEditTermId);
			if (term) {
				expanded = true;
				editingTerm = term;
				renewFromTerm = null;
				showTermForm = true;
			}
		}
	});

	function handleEditTerm(term: import('$lib/types').PolicyTerm) {
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

	async function handleDeleteTerm(term: import('$lib/types').PolicyTerm) {
		try {
			await insuranceApi.deleteTerm(policy.id, term.id);
			await onRefresh();
		} catch (error) {
			handleErrorWithNotification(error, 'Failed to delete term');
		}
	}
</script>

<Card class={!policy.isActive ? 'opacity-70' : ''}>
	<CardContent class="p-4">
		<!-- Policy header: company + settings/delete -->
		<div class="flex items-center justify-between gap-2">
			<div class="flex items-center gap-2.5 min-w-0">
				<div class="flex-shrink-0 rounded-full bg-primary/10 p-2">
					<Building2 class="h-4 w-4 text-primary" />
				</div>
				<div class="min-w-0">
					<h4 class="text-sm font-semibold text-foreground truncate">{policy.company}</h4>
					{#if latestTerm?.policyDetails.policyNumber}
						<p class="text-xs text-muted-foreground">
							Policy #{latestTerm.policyDetails.policyNumber}
						</p>
					{/if}
				</div>
			</div>
			<div class="flex items-center gap-0.5 shrink-0">
				{#if !policy.isActive}
					<Badge variant="secondary">Inactive</Badge>
				{/if}
				{#if policy.currentTermEnd}
					<ExpirationAlert currentTermEnd={policy.currentTermEnd} />
				{/if}
				<Button
					variant="ghost"
					size="icon"
					class="h-7 w-7"
					onclick={() => onEdit(policy)}
					title="Policy settings"
				>
					<Settings class="h-3.5 w-3.5" />
				</Button>
			</div>
		</div>

		<!-- Current term card -->
		{#if latestTerm}
			<div class="mt-3">
				<PolicyTermCard
					term={latestTerm}
					isCurrent={true}
					{vehicleNames}
					onEdit={handleEditTerm}
					onDelete={handleDeleteTerm}
					onRenew={handleRenew}
				/>
			</div>
		{/if}

		<!-- Past terms toggle (only if there are past terms) -->
		{#if pastTerms.length > 0}
			<div class="mt-2">
				<Button
					variant="ghost"
					size="sm"
					class="h-7 text-xs text-muted-foreground"
					onclick={() => (expanded = !expanded)}
				>
					{#if expanded}
						<ChevronUp class="mr-1 h-3 w-3" />
						Hide History
					{:else}
						<ChevronDown class="mr-1 h-3 w-3" />
						{pastTerms.length} past term{pastTerms.length !== 1 ? 's' : ''}
					{/if}
				</Button>
			</div>
		{/if}

		<!-- Expanded past terms + notes -->
		{#if expanded}
			<div class="mt-2 space-y-4">
				{#if policy.notes}
					<div>
						<p class="text-xs font-medium text-muted-foreground mb-1">Notes</p>
						<p class="text-sm text-foreground">{policy.notes}</p>
					</div>
				{/if}

				<TermHistory
					terms={pastTerms}
					policyId={policy.id}
					{vehicles}
					termVehicleCoverage={policy.termVehicleCoverage}
					{onRefresh}
					onDeleteTerm={handleDeleteTerm}
				/>
			</div>
		{/if}

		<!-- Documents (always visible) -->
		<div class="mt-3 border-t border-border pt-3">
			<DocumentViewer policyId={policy.id} />
		</div>

		<TermForm
			bind:open={showTermForm}
			policyId={policy.id}
			term={editingTerm}
			previousTerm={renewFromTerm}
			{vehicles}
			termVehicleCoverage={policy.termVehicleCoverage}
			onSuccess={handleTermSuccess}
		/>
	</CardContent>
</Card>
