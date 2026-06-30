<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { paramRoutes } from '$lib/routes';
	import { gotoDynamic } from '$lib/utils/navigation';
	import { ChevronDown, ChevronUp, Building2, Settings } from '@lucide/svelte';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import InsuranceTermCard from './PolicyTermCard.svelte';
	import ExpirationAlert from './ExpirationAlert.svelte';
	import TermHistory from './TermHistory.svelte';
	import DocumentViewer from './DocumentViewer.svelte';
	import ClaimsSection from './ClaimsSection.svelte';
	import { getLatestTerm } from '$lib/utils/insurance';
	import { insuranceApi } from '$lib/services/insurance-api';
	import { handleErrorWithNotification } from '$lib/utils/error-handling';
	import type { InsurancePolicy, Vehicle } from '$lib/types';

	interface Props {
		policy: InsurancePolicy;
		vehicleNames?: string[];
		vehicles?: Vehicle[];
		onEdit: (_policy: InsurancePolicy) => void;
		onDelete?: (_policyId: string) => void;
		onRefresh: () => Promise<void>;
		// T12b-3c: read-only shared view — hide the policy-settings, term edit/delete/renew, claim
		// file/edit/delete, and document upload/delete affordances.
		readOnly?: boolean;
	}

	let {
		policy,
		vehicleNames = [],
		vehicles = [],
		onEdit,
		onRefresh,
		readOnly = false
	}: Props = $props();

	let expanded = $state(false);
	let latestTerm = $derived(getLatestTerm(policy.terms));
	let pastTerms = $derived(policy.terms.filter(t => t.id !== latestTerm?.id));

	function handleEditTerm(term: import('$lib/types').InsuranceTerm) {
		goto(resolve(paramRoutes.insuranceTermEdit, { id: policy.id, termId: term.id }));
	}

	function handleRenew() {
		if (!latestTerm) return;
		const base = resolve(paramRoutes.insuranceTermNew, { id: policy.id });
		gotoDynamic(`${base}?renewFrom=${latestTerm.id}`);
	}

	async function handleDeleteTerm(term: import('$lib/types').InsuranceTerm) {
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
					{#if latestTerm?.policyNumber}
						<p class="text-xs text-muted-foreground">
							Policy #{latestTerm.policyNumber}
						</p>
					{/if}
				</div>
			</div>
			<div class="flex items-center gap-0.5 shrink-0">
				{#if !policy.isActive}
					<Badge variant="secondary">Inactive</Badge>
				{/if}
				{#if latestTerm?.endDate}
					<ExpirationAlert latestTermEnd={latestTerm?.endDate} />
				{/if}
				{#if !readOnly}
					<Button
						variant="ghost"
						size="icon"
						class="h-7 w-7"
						onclick={() => onEdit(policy)}
						title="Policy settings"
					>
						<Settings class="h-3.5 w-3.5" />
					</Button>
				{/if}
			</div>
		</div>

		<!-- Current term card -->
		{#if latestTerm}
			<div class="mt-3">
				<InsuranceTermCard
					term={latestTerm}
					isCurrent={true}
					{vehicleNames}
					onEdit={readOnly ? undefined : handleEditTerm}
					onDelete={readOnly ? undefined : handleDeleteTerm}
					onRenew={readOnly ? undefined : handleRenew}
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
					onDeleteTerm={readOnly ? undefined : handleDeleteTerm}
					{readOnly}
				/>
			</div>
		{/if}

		<!-- Documents. Hidden in the read-only shared view (T12b-3c): the insurance DOCUMENT reads
		     (GET /photos/insurance_policy/:id) are NOT widened for a shared viewer — only the policies
		     LIST (T8b) + claims (C475) are — so rendering DocumentViewer would 404 → "policy not found"
		     error toast. Documents are secondary; a viewer sees policy terms + claims, not attachments. -->
		{#if !readOnly}
			<div class="mt-3 border-t border-border pt-3">
				<DocumentViewer entityType="insurance_policy" entityId={policy.id} />
			</div>
		{/if}

		<!-- Claims (always visible) -->
		<div class="mt-3 border-t border-border pt-3">
			<ClaimsSection policyId={policy.id} {vehicles} {readOnly} />
		</div>
	</CardContent>
</Card>
