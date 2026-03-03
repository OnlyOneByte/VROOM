<script lang="ts">
	import {
		ChevronDown,
		ChevronUp,
		Pencil,
		Trash2,
		Building2,
		Calendar,
		RefreshCw
	} from 'lucide-svelte';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import ExpirationAlert from './ExpirationAlert.svelte';
	import TermHistory from './TermHistory.svelte';
	import TermForm from './TermForm.svelte';
	import DocumentViewer from './DocumentViewer.svelte';
	import { getLatestTerm } from '$lib/utils/insurance';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import type { InsurancePolicy, Vehicle } from '$lib/types';

	interface Props {
		policy: InsurancePolicy;
		vehicleNames?: string[];
		vehicles?: Vehicle[];
		autoEditTermId?: string | null;
		onEdit: (_policy: InsurancePolicy) => void;
		onDelete: (_policyId: string) => void;
		onRefresh: () => Promise<void>;
	}

	let {
		policy,
		vehicleNames = [],
		vehicles = [],
		autoEditTermId = null,
		onEdit,
		onDelete,
		onRefresh
	}: Props = $props();

	let expanded = $state(false);
	let latestTerm = $derived(getLatestTerm(policy.terms));
	let pastTerms = $derived(policy.terms.filter(t => t.id !== latestTerm?.id));

	function handleDelete() {
		if (confirm(`Delete policy from ${policy.company}? This cannot be undone.`)) {
			onDelete(policy.id);
		}
	}

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

	function getTermVehicleNames(termId: string): string {
		if (!policy.termVehicleCoverage || vehicles.length === 0) return '';
		return policy.termVehicleCoverage
			.filter(tc => tc.termId === termId)
			.map(tv => {
				const v = vehicles.find(vh => vh.id === tv.vehicleId);
				return v ? v.nickname || `${v.year} ${v.make} ${v.model}` : tv.vehicleId;
			})
			.join(', ');
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

			<!-- Cost summary + policy actions -->
			<div class="flex-shrink-0 flex items-start gap-2">
				<div class="text-right">
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
				<div class="flex items-center gap-0.5 ml-1">
					<Button
						variant="ghost"
						size="icon"
						class="h-7 w-7"
						onclick={() => onEdit(policy)}
						title="Edit policy"
					>
						<Pencil class="h-3.5 w-3.5" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						class="h-7 w-7 text-destructive hover:text-destructive"
						onclick={handleDelete}
						title="Delete policy"
					>
						<Trash2 class="h-3.5 w-3.5" />
					</Button>
				</div>
			</div>
		</div>

		<!-- Current term (always visible) -->
		{#if latestTerm}
			<div class="mt-3 border-t border-border pt-3">
				<div class="rounded-md border border-primary/30 bg-primary/5 p-3">
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-2">
								<div class="flex items-center gap-1 text-xs text-muted-foreground">
									<Calendar class="h-3 w-3" />
									{formatDate(latestTerm.startDate)} – {formatDate(latestTerm.endDate)}
								</div>
								<Badge variant="secondary" class="text-xs">Current</Badge>
							</div>

							<div class="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
								{#if latestTerm.financeDetails.totalCost !== undefined}
									<span>Total: {formatCurrency(latestTerm.financeDetails.totalCost)}</span>
								{/if}
								{#if latestTerm.policyDetails.policyNumber}
									<span>#{latestTerm.policyDetails.policyNumber}</span>
								{/if}
							</div>

							{#if latestTerm.policyDetails.coverageDescription}
								<p class="mt-1 text-xs text-muted-foreground truncate">
									{latestTerm.policyDetails.coverageDescription}
								</p>
							{/if}

							{#if getTermVehicleNames(latestTerm.id)}
								<p class="mt-1 text-xs text-muted-foreground">
									{getTermVehicleNames(latestTerm.id)}
								</p>
							{/if}
						</div>

						<div class="flex items-center gap-1 shrink-0">
							<Button
								variant="ghost"
								size="sm"
								class="h-7 text-xs"
								onclick={() => handleEditTerm(latestTerm)}
							>
								<Pencil class="mr-1 h-3 w-3" />
								Edit
							</Button>
							<Button variant="outline" size="sm" class="h-7 text-xs" onclick={handleRenew}>
								<RefreshCw class="mr-1 h-3 w-3" />
								Renew
							</Button>
						</div>
					</div>
				</div>
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
