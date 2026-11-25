<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { paramRoutes } from '#lib/routes.ts';
	import { gotoDynamic } from '#lib/utils/navigation.ts';
	import {
		ChevronDown,
		ChevronUp,
		Building2,
		Settings,
		Plus,
		RefreshCw,
		Upload
	} from '@lucide/svelte';
	import { Card, CardContent } from '#lib/components/ui/card/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import InsuranceTermCard from './PolicyTermCard.svelte';
	import ExpirationAlert from './ExpirationAlert.svelte';
	import TermHistory from './TermHistory.svelte';
	import DocumentViewer from './DocumentViewer.svelte';
	import ClaimsSection from './ClaimsSection.svelte';
	import { getLatestTerm, isPolicyInForce } from '#lib/utils/insurance.ts';
	import { insuranceApi } from '#lib/services/insurance-api.ts';
	import { handleErrorWithNotification } from '#lib/utils/error-handling.ts';
	import type { InsurancePolicy, Vehicle } from '#lib/types/index.ts';

	interface Props {
		policy: InsurancePolicy;
		vehicleNames?: string[];
		vehicles?: Vehicle[];
		onEdit: (_policy: InsurancePolicy) => void;
		onDelete?: (_policyId: string) => void;
		onRefresh: () => Promise<void>;
		readOnly?: boolean;
		level?: 3 | 4;
	}

	let {
		policy,
		vehicleNames = [],
		vehicles = [],
		onEdit,
		onRefresh,
		readOnly = false,
		level = 3
	}: Props = $props();

	let childLevel: 4 | 5 = $derived(level === 3 ? 4 : 5);

	let expanded = $state(false);
	let documentCount = $state<number | null>(null);
	let claimCount = $state<number | null>(null);
	let uploadOpen = $state(false);
	let claimFormOpen = $state(false);

	let attachmentSummary = $derived(
		[
			readOnly || documentCount === null ? null : plural(documentCount, 'document'),
			claimCount === null ? null : plural(claimCount, 'claim')
		]
			.filter(Boolean)
			.join(' · ')
	);

	function plural(n: number, noun: string): string {
		return `${n} ${noun}${n === 1 ? '' : 's'}`;
	}
	let latestTerm = $derived(getLatestTerm(policy.terms));
	let pastTerms = $derived(policy.terms.filter(t => t.id !== latestTerm?.id));

	function handleEditTerm(term: import('#lib/types/index.ts').InsuranceTerm) {
		goto(resolve(paramRoutes.insuranceTermEdit, { id: policy.id, termId: term.id }));
	}

	function handleRenew() {
		if (!latestTerm) return;
		const base = resolve(paramRoutes.insuranceTermNew, { id: policy.id });
		gotoDynamic(`${base}?renewFrom=${latestTerm.id}`);
	}

	async function handleDeleteTerm(term: import('#lib/types/index.ts').InsuranceTerm) {
		try {
			await insuranceApi.deleteTerm(policy.id, term.id);
			await onRefresh();
		} catch (error) {
			handleErrorWithNotification(error, "Couldn't delete the term");
		}
	}
</script>

<Card class="py-0" data-in-force={isPolicyInForce(policy)}>
	<CardContent class="p-4">
		<div class="flex items-center justify-between gap-2">
			<div class="flex items-center gap-2.5 min-w-0">
				<div class="flex-shrink-0 rounded-full bg-primary/10 p-2">
					<Building2 class="h-4 w-4 text-primary" />
				</div>
				<div class="min-w-0">
					<svelte:element
						this={`h${level}`}
						class="truncate text-base font-semibold text-foreground"
					>
						{policy.company}
					</svelte:element>
					{#if latestTerm?.policyNumber}
						<p class="text-xs text-muted-foreground">
							Policy #{latestTerm.policyNumber}
						</p>
					{/if}
				</div>
			</div>
			<div class="flex items-center gap-2 shrink-0">
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
						class="size-10 sm:size-9"
						onclick={() => onEdit(policy)}
						title="Policy settings"
						aria-label="Policy settings"
					>
						<Settings />
					</Button>
				{/if}
			</div>
		</div>

		{#if latestTerm}
			<div class="mt-3">
				<InsuranceTermCard
					term={latestTerm}
					isCurrent={true}
					{vehicleNames}
					onEdit={readOnly ? undefined : handleEditTerm}
					onDelete={readOnly ? undefined : handleDeleteTerm}
				/>
			</div>
		{/if}

		{#if pastTerms.length > 0}
			<div class="mt-2">
				<Button
					variant="ghost"
					size="sm"
					class="h-10 sm:h-8 text-muted-foreground"
					aria-expanded={expanded}
					onclick={() => (expanded = !expanded)}
				>
					{#if expanded}
						<ChevronUp />
						Hide History
					{:else}
						<ChevronDown />
						{pastTerms.length} past term{pastTerms.length !== 1 ? 's' : ''}
					{/if}
				</Button>
			</div>
		{/if}

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
					level={childLevel}
				/>
			</div>
		{/if}

		<div class="mt-3 border-t border-border pt-3">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<p class="text-xs text-muted-foreground" data-testid="policy-attachments">
					{attachmentSummary}
				</p>
				{#if !readOnly}
					<div class="flex flex-wrap items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							class="h-10 sm:h-8"
							onclick={() => (uploadOpen = true)}
						>
							<Upload />
							Upload
						</Button>
						{#if !claimFormOpen}
							<Button
								variant="outline"
								size="sm"
								class="h-10 sm:h-8"
								onclick={() => (claimFormOpen = true)}
							>
								<Plus />
								File Claim
							</Button>
						{/if}
						{#if latestTerm}
							<Button variant="outline" size="sm" class="h-10 sm:h-8" onclick={handleRenew}>
								<RefreshCw />
								Renew
							</Button>
						{/if}
					</div>
				{/if}
			</div>

			{#if !readOnly}
				<DocumentViewer
					entityType="insurance_policy"
					entityId={policy.id}
					level={childLevel}
					compact
					bind:count={documentCount}
					bind:uploadOpen
				/>
			{/if}
			<ClaimsSection
				policyId={policy.id}
				{vehicles}
				{readOnly}
				level={childLevel}
				compact
				bind:count={claimCount}
				bind:formOpen={claimFormOpen}
			/>
		</div>
	</CardContent>
</Card>
