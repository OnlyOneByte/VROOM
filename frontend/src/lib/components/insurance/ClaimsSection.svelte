<script lang="ts">
	import { authStore } from '#lib/stores/auth.svelte.ts';
	import { onMount } from 'svelte';
	import { trackPendingSave } from '#lib/utils/pending-saves.ts';
	import { SvelteSet } from 'svelte/reactivity';
	import { Plus, Trash2, Pencil, LoaderCircle, ShieldAlert, Paperclip } from '@lucide/svelte';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import DocumentViewer from './DocumentViewer.svelte';
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { Textarea } from '#lib/components/ui/textarea/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import DatePicker from '#lib/components/common/date-picker.svelte';
	import { insuranceApi } from '#lib/services/insurance-api.ts';
	import {
		handleErrorWithNotification,
		logLoadFailure,
		userFacingErrorMessage
	} from '#lib/utils/error-handling.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import {
		amountPlaceholder,
		amountStep,
		capitalize,
		formatCurrency,
		formatDate,
		dateOnlyToISO,
		toDateInputValue
	} from '#lib/utils/formatters.ts';
	import { CLAIM_STATUS_LABELS, enteredAmount } from '#lib/utils/insurance.ts';
	import { getVehicleDisplayName } from '#lib/utils/vehicle-helpers.ts';
	import {
		CLAIM_TYPES,
		CLAIM_STATUSES,
		FAULT_DESIGNATIONS,
		type ClaimStatus,
		type ClaimType,
		type FaultDesignation,
		type InsuranceClaim,
		type Vehicle
	} from '#lib/types/index.ts';

	interface Props {
		policyId: string;
		vehicles?: Vehicle[];
		coveredVehicleIds?: string[];
		readOnly?: boolean;
		level?: 4 | 5;
		compact?: boolean;
		count?: number | null;
		formOpen?: boolean;
		loadError?: string | null;
		inlineError?: boolean;
	}

	let {
		policyId,
		vehicles = [],
		coveredVehicleIds,
		readOnly = false,
		level = 4,
		compact = false,
		count = $bindable(null),
		formOpen = $bindable(false),
		loadError = $bindable(null),
		inlineError = true
	}: Props = $props();

	let vehicleNameMap = $derived(new Map(vehicles.map(v => [v.id, getVehicleDisplayName(v)])));
	let claimableVehicles = $derived(
		coveredVehicleIds ? vehicles.filter(v => coveredVehicleIds.includes(v.id)) : vehicles
	);

	let claims = $state<InsuranceClaim[]>([]);
	let isLoading = $state(true);
	let hasLoaded = $state(false);
	const expandedDocs = new SvelteSet<string>();

	function toggleDocs(claimId: string) {
		if (expandedDocs.has(claimId)) expandedDocs.delete(claimId);
		else expandedDocs.add(claimId);
	}

	let editingId = $state<string | null>(null);
	let isSaving = $state(false);

	onMount(() => trackPendingSave(() => isSaving));
	let claimDate = $state('');
	let vehicleId = $state('');
	let claimType = $state<ClaimType>('collision');
	let status = $state<ClaimStatus>('filed');
	let payoutAmount = $state('');
	let faultDesignation = $state<FaultDesignation | ''>('');
	let description = $state('');

	const STATUS_LABELS = CLAIM_STATUS_LABELS;
	const FAULT_LABELS: Record<FaultDesignation, string> = {
		at_fault: 'At fault',
		not_at_fault: 'Not at fault',
		shared: 'Shared fault'
	};
	const STATUS_VARIANT: Record<ClaimStatus, 'info' | 'soon' | 'ok' | 'due'> = {
		filed: 'info',
		in_progress: 'soon',
		settled: 'ok',
		denied: 'due'
	};

	onMount(loadClaims);

	$effect(() => {
		count = !hasLoaded || loadError ? null : claims.length;
	});

	export function reload() {
		return loadClaims();
	}

	async function loadClaims() {
		isLoading = true;
		try {
			claims = await insuranceApi.getClaims(policyId);
			hasLoaded = true;
			loadError = null;
		} catch (err) {
			loadError = userFacingErrorMessage(err);
			logLoadFailure(err, "Couldn't load claims");
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
		formOpen = true;
	}

	function openEdit(claim: InsuranceClaim) {
		editingId = claim.id;
		claimDate = claim.claimDate ? toDateInputValue(claim.claimDate) : '';
		vehicleId = claim.vehicleId ?? '';
		claimType = claim.claimType;
		status = claim.status;
		payoutAmount = claim.payoutAmount != null ? String(claim.payoutAmount) : '';
		faultDesignation = claim.faultDesignation ?? '';
		description = claim.description ?? '';
		formOpen = true;
	}

	function closeForm() {
		formOpen = false;
		resetForm();
	}

	function setDialogOpen(open: boolean) {
		if (open) formOpen = true;
		else if (!isSaving) closeForm();
	}

	async function handleSubmit() {
		if (!claimDate) {
			appStore.showError('Enter a claim date.');
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
				// JSON drops undefined; send null to clear an emptied optional.
				await insuranceApi.updateClaim(policyId, editingId, {
					...common,
					description: description.trim() || null,
					payoutAmount: enteredAmount(payoutAmount) ?? null,
					faultDesignation: faultDesignation || null,
					vehicleId: vehicleId || null
				});
			} else {
				await insuranceApi.createClaim(policyId, {
					...common,
					description: description.trim() || undefined,
					payoutAmount: enteredAmount(payoutAmount),
					faultDesignation: faultDesignation || undefined,
					vehicleId: vehicleId || undefined
				});
			}
			await loadClaims();
			closeForm();
		} catch (err) {
			handleErrorWithNotification(err, `Couldn't ${editingId ? 'update' : 'file'} the claim`);
		} finally {
			isSaving = false;
		}
	}

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
			handleErrorWithNotification(err, "Couldn't delete the claim");
			throw err;
		}
	}
</script>

{#if !compact || (loadError && inlineError) || (hasLoaded && claims.length > 0)}
	<div class={compact ? 'mt-3 space-y-3' : 'space-y-3'}>
		<div class="flex items-center justify-between">
			<svelte:element this={`h${level}`} class="text-sm font-medium text-foreground">
				Claims
			</svelte:element>
			{#if !readOnly && !compact}
				<Button variant="outline" size="sm" class="h-10" onclick={openNew}>
					<Plus />
					File claim
				</Button>
			{/if}
		</div>

		{#if loadError && inlineError}
			<LoadErrorCard
				compact
				title="Couldn't load the claims"
				message={loadError}
				onRetry={loadClaims}
			/>
		{:else if isLoading && !hasLoaded}
			<div class="space-y-2" aria-hidden="true" data-testid="claims-loading">
				<Skeleton class="h-12 w-full" />
			</div>
		{:else}
			{#if claims.length === 0}
				<div class="flex flex-col items-center py-4 text-center">
					<ShieldAlert class="mb-2 h-6 w-6 text-muted-foreground" />
					<p class="text-xs text-muted-foreground">No claims filed.</p>
				</div>
			{:else if claims.length > 0}
				<ul class="divide-y divide-border border-y border-border">
					{#each claims as claim (claim.id)}
						<li class="py-3">
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0 flex-1">
									<div class="flex flex-wrap items-center gap-2">
										<span class="text-sm font-medium text-foreground">
											{capitalize(claim.claimType)}
										</span>
										<Badge variant={STATUS_VARIANT[claim.status]} class="text-xs">
											{STATUS_LABELS[claim.status]}
										</Badge>
										{#if claim.faultDesignation}
											<Badge variant="outline" class="text-xs">
												{FAULT_LABELS[claim.faultDesignation]}
											</Badge>
										{/if}
									</div>
									<div
										class="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground"
									>
										<span>{formatDate(claim.claimDate)}</span>
										{#if claim.payoutAmount != null}
											<span class="tabular-nums">Payout: {formatCurrency(claim.payoutAmount)}</span>
										{/if}
										{#if claim.vehicleId && vehicleNameMap.has(claim.vehicleId)}
											<span>{vehicleNameMap.get(claim.vehicleId)}</span>
										{/if}
									</div>
									{#if claim.description}
										<p class="mt-1 line-clamp-2 text-xs break-words text-muted-foreground">
											{claim.description}
										</p>
									{/if}
								</div>
								<div class="flex shrink-0 items-center gap-2">
									{#if !readOnly}
										<Button
											variant="ghost"
											size="icon"
											class="size-10"
											aria-label="Claim documents"
											aria-expanded={expandedDocs.has(claim.id)}
											onclick={() => toggleDocs(claim.id)}
										>
											<Paperclip />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											class="size-10"
											aria-label="Edit claim"
											onclick={() => openEdit(claim)}
										>
											<Pencil />
										</Button>
										{#if authStore.user?.demo !== true}
											<Button
												variant="ghost"
												size="icon"
												class="size-10"
												aria-label="Delete claim"
												onclick={() => requestDelete(claim.id)}
											>
												<Trash2 />
											</Button>
										{/if}
									{/if}
								</div>
							</div>
							{#if expandedDocs.has(claim.id)}
								<div class="mt-3 border-t border-border pt-3">
									<DocumentViewer
										entityType="insurance_claim"
										entityId={claim.id}
										{readOnly}
										level={level === 4 ? 5 : 6}
									/>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
{/if}

<ConfirmDialog
	bind:open={confirmOpen}
	title="Delete claim?"
	description="This permanently removes the claim and its linked documents. This cannot be undone."
	onConfirm={performDelete}
/>

<Dialog.Root bind:open={() => formOpen, setDialogOpen}>
	<Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{editingId ? 'Edit claim' : 'File a claim'}</Dialog.Title>
			<Dialog.Description>Record what happened and where the claim stands.</Dialog.Description>
		</Dialog.Header>
		<form
			class="space-y-4"
			onsubmit={e => {
				e.preventDefault();
				handleSubmit();
			}}
		>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<div class="space-y-1">
					<Label for={`claim-date-${policyId}`}>Date *</Label>
					<DatePicker
						id={`claim-date-${policyId}`}
						bind:value={claimDate}
						placeholder="Claim date"
					/>
				</div>
				<div class="space-y-1">
					<Label for={`claim-type-${policyId}`}>Type</Label>
					<Select.Root
						type="single"
						value={claimType}
						onValueChange={v => (claimType = v as ClaimType)}
					>
						<Select.Trigger id={`claim-type-${policyId}`} class="w-full">
							{capitalize(claimType)}
						</Select.Trigger>
						<Select.Content>
							{#each CLAIM_TYPES as t (t)}
								<Select.Item value={t} label={capitalize(t)}>{capitalize(t)}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="space-y-1">
					<Label for={`claim-status-${policyId}`}>Status</Label>
					<Select.Root
						type="single"
						value={status}
						onValueChange={v => (status = v as ClaimStatus)}
					>
						<Select.Trigger id={`claim-status-${policyId}`} class="w-full">
							{STATUS_LABELS[status]}
						</Select.Trigger>
						<Select.Content>
							{#each CLAIM_STATUSES as s (s)}
								<Select.Item value={s} label={STATUS_LABELS[s]}>{STATUS_LABELS[s]}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="space-y-1">
					<Label for={`claim-payout-${policyId}`}>Payout amount</Label>
					<Input
						id={`claim-payout-${policyId}`}
						type="number"
						step={amountStep()}
						min="0"
						bind:value={payoutAmount}
						placeholder={amountPlaceholder()}
					/>
				</div>
				<div class="space-y-1 sm:col-span-2">
					<Label for={`claim-fault-${policyId}`}>Fault</Label>
					<Select.Root
						type="single"
						value={faultDesignation}
						onValueChange={v => (faultDesignation = (v ?? '') as FaultDesignation | '')}
					>
						<Select.Trigger id={`claim-fault-${policyId}`} class="w-full">
							{faultDesignation ? FAULT_LABELS[faultDesignation] : 'Not specified'}
						</Select.Trigger>
						<Select.Content>
							{#each FAULT_DESIGNATIONS as f (f)}
								<Select.Item value={f} label={FAULT_LABELS[f]}>{FAULT_LABELS[f]}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				{#if claimableVehicles.length > 0}
					<div class="space-y-1 sm:col-span-2">
						<Label for={`claim-vehicle-${policyId}`}>Vehicle (optional)</Label>
						<Select.Root type="single" value={vehicleId} onValueChange={v => (vehicleId = v ?? '')}>
							<Select.Trigger id={`claim-vehicle-${policyId}`} class="w-full">
								{vehicleId && vehicleNameMap.has(vehicleId)
									? vehicleNameMap.get(vehicleId)
									: 'Not specified'}
							</Select.Trigger>
							<Select.Content>
								{#each claimableVehicles as v (v.id)}
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
				<Label for={`claim-desc-${policyId}`}>Description</Label>
				<Textarea
					id={`claim-desc-${policyId}`}
					bind:value={description}
					rows={2}
					placeholder="What happened?"
				/>
			</div>

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={closeForm} disabled={isSaving}>
					Cancel
				</Button>
				<Button type="submit" disabled={isSaving}>
					{#if isSaving}
						<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
					{/if}
					{editingId ? 'Save' : 'File claim'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
