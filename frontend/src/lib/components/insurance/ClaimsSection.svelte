<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { Plus, Trash2, Pencil, LoaderCircle, ShieldAlert, X, Paperclip } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import DocumentViewer from './DocumentViewer.svelte';
	import ConfirmDialog from '$lib/components/common/ConfirmDialog.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Select from '$lib/components/ui/select';
	import DatePicker from '$lib/components/common/date-picker.svelte';
	import { insuranceApi } from '$lib/services/insurance-api';
	import { handleErrorWithNotification } from '$lib/utils/error-handling';
	import {
		capitalize,
		formatCurrency,
		formatDate,
		dateOnlyToISO,
		toDateInputValue
	} from '$lib/utils/formatters';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import {
		CLAIM_TYPES,
		CLAIM_STATUSES,
		FAULT_DESIGNATIONS,
		type ClaimStatus,
		type ClaimType,
		type FaultDesignation,
		type InsuranceClaim,
		type Vehicle
	} from '$lib/types';

	interface Props {
		policyId: string;
		// Vehicles covered by this policy — lets a claim be attributed to one.
		vehicles?: Vehicle[];
		// T12b-3c: read-only shared view hides File/Edit/Delete claim (claims + their docs stay viewable).
		readOnly?: boolean;
	}

	let { policyId, vehicles = [], readOnly = false }: Props = $props();

	// vehicleId → display name, for showing/selecting the claim's vehicle.
	let vehicleNameMap = $derived(new Map(vehicles.map(v => [v.id, getVehicleDisplayName(v)])));

	let claims = $state<InsuranceClaim[]>([]);
	let isLoading = $state(true);
	let loadError = $state<string | null>(null);
	// Claim ids whose document drawer is open.
	const expandedDocs = new SvelteSet<string>();

	function toggleDocs(claimId: string) {
		if (expandedDocs.has(claimId)) expandedDocs.delete(claimId);
		else expandedDocs.add(claimId);
	}

	// Inline form state. editingId === null while filing a new claim.
	let showForm = $state(false);
	let editingId = $state<string | null>(null);
	let isSaving = $state(false);
	let claimDate = $state('');
	let vehicleId = $state('');
	let claimType = $state<ClaimType>('collision');
	let status = $state<ClaimStatus>('filed');
	let payoutAmount = $state('');
	let faultDesignation = $state<FaultDesignation | ''>('');
	let description = $state('');

	// Human-friendly labels for the snake_case enum values.
	const STATUS_LABELS: Record<ClaimStatus, string> = {
		filed: 'Filed',
		in_progress: 'In progress',
		settled: 'Settled',
		denied: 'Denied'
	};
	const FAULT_LABELS: Record<FaultDesignation, string> = {
		at_fault: 'At fault',
		not_at_fault: 'Not at fault',
		shared: 'Shared fault'
	};
	// Badge variants are token-based and WCAG-AA verified. We deliberately do NOT
	// use `text-chart-*` on a `bg-chart-*/10` tint — that combo (esp. chart-2 teal
	// at 3.26:1) fails the AA color-contrast gate. 'denied' uses destructive;
	// everything else uses secondary/outline, distinguished by the label text.
	const STATUS_VARIANT: Record<ClaimStatus, 'secondary' | 'outline' | 'destructive'> = {
		filed: 'outline',
		in_progress: 'secondary',
		settled: 'secondary',
		denied: 'destructive'
	};

	onMount(loadClaims);

	async function loadClaims() {
		isLoading = true;
		loadError = null;
		try {
			claims = await insuranceApi.getClaims(policyId);
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load claims';
			handleErrorWithNotification(err, 'Failed to load claims');
		} finally {
			isLoading = false;
		}
	}

	function resetForm() {
		editingId = null;
		claimDate = '';
		vehicleId = '';
		claimType = 'collision';
		status = 'filed';
		payoutAmount = '';
		faultDesignation = '';
		description = '';
	}

	function openNew() {
		resetForm();
		showForm = true;
	}

	function openEdit(claim: InsuranceClaim) {
		editingId = claim.id;
		// Local calendar date, not a bare UTC `.split('T')[0]` (#138 sibling): the save persists via
		// dateOnlyToISO → noon-local, so slicing the UTC date shifts the claim date back a day on edit for
		// UTC+13/+14 users. toDateInputValue reads local Y/M/D, matching the InsuranceTermForm + #131 fix.
		claimDate = claim.claimDate ? toDateInputValue(claim.claimDate) : '';
		vehicleId = claim.vehicleId ?? '';
		claimType = claim.claimType;
		status = claim.status;
		payoutAmount = claim.payoutAmount != null ? String(claim.payoutAmount) : '';
		faultDesignation = claim.faultDesignation ?? '';
		description = claim.description ?? '';
		showForm = true;
	}

	function closeForm() {
		showForm = false;
		resetForm();
	}

	async function handleSubmit() {
		if (!claimDate) {
			handleErrorWithNotification(new Error('Claim date is required'), 'Claim date is required');
			return;
		}
		isSaving = true;
		const common = {
			claimDate: dateOnlyToISO(claimDate),
			claimType,
			status
		};
		try {
			if (editingId) {
				// On EDIT, an emptied optional field must be sent as null (not
				// undefined) so the column can be cleared — JSON.stringify drops
				// undefined keys, so the backend would otherwise keep the old value.
				// updateClaim's schema accepts nullish for all of these.
				await insuranceApi.updateClaim(policyId, editingId, {
					...common,
					description: description.trim() || null,
					payoutAmount: payoutAmount ? Number(payoutAmount) : null,
					faultDesignation: faultDesignation || null,
					vehicleId: vehicleId || null
				});
			} else {
				// On CREATE, omit empty optionals (no value to clear).
				await insuranceApi.createClaim(policyId, {
					...common,
					description: description.trim() || undefined,
					payoutAmount: payoutAmount ? Number(payoutAmount) : undefined,
					faultDesignation: faultDesignation || undefined,
					vehicleId: vehicleId || undefined
				});
			}
			await loadClaims();
			closeForm();
		} catch (err) {
			handleErrorWithNotification(err, `Failed to ${editingId ? 'update' : 'file'} claim`);
		} finally {
			isSaving = false;
		}
	}

	// Styled confirm dialog (replaces native confirm()).
	let confirmOpen = $state(false);
	let pendingDeleteId = $state<string | null>(null);

	function requestDelete(claimId: string) {
		pendingDeleteId = claimId;
		confirmOpen = true;
	}

	async function performDelete() {
		if (!pendingDeleteId) return;
		const claimId = pendingDeleteId;
		try {
			await insuranceApi.deleteClaim(policyId, claimId);
			claims = claims.filter(c => c.id !== claimId);
		} catch (err) {
			handleErrorWithNotification(err, 'Failed to delete claim');
			throw err; // keep the dialog open on failure
		}
	}
</script>

<div class="space-y-3">
	<div class="flex items-center justify-between">
		<h5 class="text-sm font-medium text-foreground">Claims</h5>
		{#if !showForm && !readOnly}
			<Button variant="outline" size="sm" class="h-7 text-xs" onclick={openNew}>
				<Plus class="mr-1 h-3 w-3" />
				File Claim
			</Button>
		{/if}
	</div>

	{#if isLoading}
		<div class="flex items-center justify-center py-4">
			<LoaderCircle class="h-5 w-5 animate-spin text-muted-foreground" />
		</div>
	{:else if loadError}
		<div class="rounded-md border border-destructive/40 bg-destructive/10 p-3">
			<p class="text-xs text-destructive">{loadError}</p>
			<Button variant="outline" size="sm" class="mt-2 h-7 text-xs" onclick={loadClaims}>
				Retry
			</Button>
		</div>
	{:else}
		{#if claims.length === 0 && !showForm}
			<div class="flex flex-col items-center py-4 text-center">
				<ShieldAlert class="mb-2 h-6 w-6 text-muted-foreground" />
				<p class="text-xs text-muted-foreground">No claims filed.</p>
			</div>
		{:else if claims.length > 0}
			<div class="space-y-2">
				{#each claims as claim (claim.id)}
					<div class="rounded-md border border-border p-3">
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<span class="text-sm font-medium text-foreground">{capitalize(claim.claimType)}</span>
									<Badge variant={STATUS_VARIANT[claim.status]} class="text-xs">
										{STATUS_LABELS[claim.status]}
									</Badge>
									{#if claim.faultDesignation}
										<Badge variant="outline" class="text-xs">
											{FAULT_LABELS[claim.faultDesignation]}
										</Badge>
									{/if}
								</div>
								<div class="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
									<span>{formatDate(claim.claimDate)}</span>
									{#if claim.payoutAmount != null}
										<span>Payout: {formatCurrency(claim.payoutAmount)}</span>
									{/if}
									{#if claim.vehicleId && vehicleNameMap.has(claim.vehicleId)}
										<span>{vehicleNameMap.get(claim.vehicleId)}</span>
									{/if}
								</div>
								{#if claim.description}
									<p class="mt-1 truncate text-xs text-muted-foreground">{claim.description}</p>
								{/if}
							</div>
							<div class="flex shrink-0 items-center gap-0.5">
								{#if !readOnly}
									<!-- Paperclip toggles the claim DocumentViewer (GET /photos/insurance_claim/:id),
									     which is NOT widened for a shared viewer (T12b-3c) → hide it read-only, same
									     reason the policy DocumentViewer is hidden in PolicyCard. -->
									<Button
										variant="ghost"
										size="icon"
										class="h-7 w-7"
										aria-label="Claim documents"
										onclick={() => toggleDocs(claim.id)}
									>
										<Paperclip class="h-3.5 w-3.5" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										class="h-7 w-7"
										aria-label="Edit claim"
										onclick={() => openEdit(claim)}
									>
										<Pencil class="h-3.5 w-3.5" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										class="h-7 w-7"
										aria-label="Delete claim"
										onclick={() => requestDelete(claim.id)}
									>
										<Trash2 class="h-3.5 w-3.5 text-destructive" />
									</Button>
								{/if}
							</div>
						</div>
						{#if expandedDocs.has(claim.id)}
							<div class="mt-3 border-t border-border pt-3">
								<DocumentViewer entityType="insurance_claim" entityId={claim.id} {readOnly} />
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		{#if showForm}
			<form
				class="space-y-3 rounded-md border border-border p-3"
				onsubmit={e => {
					e.preventDefault();
					handleSubmit();
				}}
			>
				<div class="flex items-center justify-between">
					<p class="text-sm font-medium">{editingId ? 'Edit claim' : 'File a claim'}</p>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						class="h-7 w-7"
						aria-label="Cancel"
						onclick={closeForm}
					>
						<X class="h-3.5 w-3.5" />
					</Button>
				</div>

				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<div class="space-y-1">
						<Label for="claim-date">Date *</Label>
						<DatePicker id="claim-date" bind:value={claimDate} placeholder="Claim date" />
					</div>
					<div class="space-y-1">
						<Label for="claim-type">Type</Label>
						<Select.Root type="single" value={claimType} onValueChange={v => (claimType = v as ClaimType)}>
							<Select.Trigger id="claim-type" class="w-full">{capitalize(claimType)}</Select.Trigger>
							<Select.Content>
								{#each CLAIM_TYPES as t (t)}
									<Select.Item value={t} label={capitalize(t)}>{capitalize(t)}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<div class="space-y-1">
						<Label for="claim-status">Status</Label>
						<Select.Root type="single" value={status} onValueChange={v => (status = v as ClaimStatus)}>
							<Select.Trigger id="claim-status" class="w-full">{STATUS_LABELS[status]}</Select.Trigger>
							<Select.Content>
								{#each CLAIM_STATUSES as s (s)}
									<Select.Item value={s} label={STATUS_LABELS[s]}>{STATUS_LABELS[s]}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<div class="space-y-1">
						<Label for="claim-payout">Payout amount</Label>
						<Input id="claim-payout" type="number" step="0.01" min="0" bind:value={payoutAmount} placeholder="0.00" />
					</div>
					<div class="space-y-1 sm:col-span-2">
						<Label for="claim-fault">Fault</Label>
						<Select.Root
							type="single"
							value={faultDesignation}
							onValueChange={v => (faultDesignation = (v ?? '') as FaultDesignation | '')}
						>
							<Select.Trigger id="claim-fault" class="w-full">
								{faultDesignation ? FAULT_LABELS[faultDesignation] : 'Not specified'}
							</Select.Trigger>
							<Select.Content>
								{#each FAULT_DESIGNATIONS as f (f)}
									<Select.Item value={f} label={FAULT_LABELS[f]}>{FAULT_LABELS[f]}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					{#if vehicles.length > 0}
						<div class="space-y-1 sm:col-span-2">
							<Label for="claim-vehicle">Vehicle (optional)</Label>
							<Select.Root
								type="single"
								value={vehicleId}
								onValueChange={v => (vehicleId = v ?? '')}
							>
								<Select.Trigger id="claim-vehicle" class="w-full">
									{vehicleId && vehicleNameMap.has(vehicleId)
										? vehicleNameMap.get(vehicleId)
										: 'Not specified'}
								</Select.Trigger>
								<Select.Content>
									{#each vehicles as v (v.id)}
										<Select.Item value={v.id} label={getVehicleDisplayName(v)}>
											{getVehicleDisplayName(v)}
										</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					{/if}
				</div>

				<div class="space-y-1">
					<Label for="claim-desc">Description</Label>
					<Textarea id="claim-desc" bind:value={description} rows={2} placeholder="What happened?" />
				</div>

				<div class="flex justify-end gap-2">
					<Button type="button" variant="ghost" size="sm" onclick={closeForm} disabled={isSaving}>
						Cancel
					</Button>
					<Button type="submit" size="sm" disabled={isSaving}>
						{#if isSaving}
							<LoaderCircle class="mr-1 h-3.5 w-3.5 animate-spin" />
						{/if}
						{editingId ? 'Save' : 'File Claim'}
					</Button>
				</div>
			</form>
		{/if}
	{/if}
</div>

<ConfirmDialog
	bind:open={confirmOpen}
	title="Delete claim?"
	description="This permanently removes the claim and its linked documents. This cannot be undone."
	onConfirm={performDelete}
/>
