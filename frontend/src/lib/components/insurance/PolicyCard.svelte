<script lang="ts">
	import { ChevronDown, ChevronUp, Pencil, Trash2, Building2 } from 'lucide-svelte';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import ExpirationAlert from './ExpirationAlert.svelte';
	import TermHistory from './TermHistory.svelte';
	import DocumentViewer from './DocumentViewer.svelte';
	import { getLatestTerm } from '$lib/utils/insurance';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import type { InsurancePolicy } from '$lib/types';

	interface Props {
		policy: InsurancePolicy;
		vehicleNames?: string[];
		onEdit: (_policy: InsurancePolicy) => void;
		onDelete: (_policyId: string) => void;
		onRefresh: () => Promise<void>;
	}

	let { policy, vehicleNames = [], onEdit, onDelete, onRefresh }: Props = $props();

	let expanded = $state(false);
	let latestTerm = $derived(getLatestTerm(policy.terms));

	function handleDelete() {
		if (confirm(`Delete policy from ${policy.company}? This cannot be undone.`)) {
			onDelete(policy.id);
		}
	}
</script>

<Card class={!policy.isActive ? 'opacity-70' : ''}>
	<CardContent class="p-4">
		<!-- Header row -->
		<div class="flex items-start justify-between gap-3">
			<div class="flex items-start gap-3 min-w-0 flex-1">
				<div class="flex-shrink-0 rounded-full bg-primary/10 p-2">
					<Building2 class="h-4 w-4 text-primary" />
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-2">
						<h4 class="text-sm font-semibold text-foreground truncate">{policy.company}</h4>
						{#if !policy.isActive}
							<Badge variant="secondary">Inactive</Badge>
						{/if}
						{#if policy.isActive && policy.currentTermEnd}
							<ExpirationAlert currentTermEnd={policy.currentTermEnd} />
						{/if}
					</div>

					{#if latestTerm}
						<div class="mt-1 space-y-0.5">
							{#if latestTerm.policyDetails.policyNumber}
								<p class="text-xs text-muted-foreground">
									Policy #{latestTerm.policyDetails.policyNumber}
								</p>
							{/if}
							{#if policy.currentTermStart && policy.currentTermEnd}
								<p class="text-xs text-muted-foreground">
									{formatDate(policy.currentTermStart)} – {formatDate(policy.currentTermEnd)}
								</p>
							{/if}
							{#if vehicleNames.length > 0}
								<p class="text-xs text-muted-foreground">
									{vehicleNames.join(', ')}
								</p>
							{/if}
						</div>
					{/if}
				</div>
			</div>

			<!-- Cost summary -->
			<div class="flex-shrink-0 text-right">
				{#if latestTerm?.financeDetails.totalCost !== undefined}
					<p class="text-sm font-semibold text-foreground">
						{formatCurrency(latestTerm.financeDetails.totalCost)}
					</p>
					<p class="text-xs text-muted-foreground">total</p>
				{/if}
				{#if latestTerm?.financeDetails.monthlyCost !== undefined}
					<p class="text-xs text-muted-foreground">
						{formatCurrency(latestTerm.financeDetails.monthlyCost)}/mo
					</p>
				{/if}
			</div>
		</div>

		<!-- Actions row -->
		<div class="mt-3 flex items-center justify-between border-t border-border pt-3">
			<Button
				variant="ghost"
				size="sm"
				class="h-7 text-xs text-muted-foreground"
				onclick={() => (expanded = !expanded)}
			>
				{#if expanded}
					<ChevronUp class="mr-1 h-3 w-3" />
					Hide Details
				{:else}
					<ChevronDown class="mr-1 h-3 w-3" />
					{policy.terms.length} term{policy.terms.length !== 1 ? 's' : ''}
				{/if}
			</Button>

			<div class="flex items-center gap-1">
				<Button variant="ghost" size="sm" class="h-7 text-xs" onclick={() => onEdit(policy)}>
					<Pencil class="mr-1 h-3 w-3" />
					Edit
				</Button>
				<Button
					variant="ghost"
					size="sm"
					class="h-7 text-xs text-destructive hover:text-destructive"
					onclick={handleDelete}
				>
					<Trash2 class="mr-1 h-3 w-3" />
					Delete
				</Button>
			</div>
		</div>

		<!-- Expanded details -->
		{#if expanded}
			<div class="mt-3 space-y-4 border-t border-border pt-3">
				{#if policy.notes}
					<div>
						<p class="text-xs font-medium text-muted-foreground mb-1">Notes</p>
						<p class="text-sm text-foreground">{policy.notes}</p>
					</div>
				{/if}

				<TermHistory terms={policy.terms} policyId={policy.id} {onRefresh} />
				<DocumentViewer policyId={policy.id} />
			</div>
		{/if}
	</CardContent>
</Card>
