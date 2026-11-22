<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { routes } from '#lib/routes.ts';
	import { gotoDynamic, gotoWithQuery } from '#lib/utils/navigation.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { trackPendingSave } from '#lib/utils/pending-saves.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { LoaderCircle, CreditCard, Info, CircleAlert, TriangleAlert } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import CategorySelector from './CategorySelector.svelte';
	import FuelFieldsSection from './FuelFieldsSection.svelte';
	import ExpensePhotoSection from './ExpensePhotoSection.svelte';
	import PendingPhotoPreview from './PendingPhotoPreview.svelte';
	import ReceiptScanButton from './ReceiptScanButton.svelte';
	import type { ReceiptDraft } from '#lib/services/vlm-api.ts';
	import FormLayout from '#lib/components/common/form-layout.svelte';
	import {
		ExpenseFormState,
		FUEL_NEEDS_VEHICLE_MESSAGE,
		type ExpenseFormContext
	} from './expense-form/expense-form-state.svelte';
	import {
		applyPreselections,
		loadExpense,
		loadQueuedExpense,
		loadVehicleContext,
		loadVehicles
	} from './expense-form/expense-form-loaders';
	import { deleteExpense, submitExpense } from './expense-form/expense-form-actions';
	import { saveQueuedExpense } from './expense-form/requeue-expense';
	import { buildDuplicateQuery } from './expense-form/expense-navigation';
	import InsuranceManagedView from './expense-form/InsuranceManagedView.svelte';
	import VehicleSelectField from './expense-form/VehicleSelectField.svelte';
	import SplitVehiclePicker from './expense-form/SplitVehiclePicker.svelte';
	import MileageField from './expense-form/MileageField.svelte';
	import SplitMileageReadings from './expense-form/SplitMileageReadings.svelte';
	import ExpenseFormHeader from './expense-form/ExpenseFormHeader.svelte';
	import ExpenseActionBar from './expense-form/ExpenseActionBar.svelte';
	import ExpenseDeleteDialog from './expense-form/ExpenseDeleteDialog.svelte';
	import ExpenseDateAmountFields from './expense-form/ExpenseDateAmountFields.svelte';
	import ExpenseNotesFields from './expense-form/ExpenseNotesFields.svelte';
	import ExpenseSplitBreakdown from './expense-form/ExpenseSplitBreakdown.svelte';
	import ExpenseFormSubtitle from './expense-form/ExpenseFormSubtitle.svelte';

	interface Props {
		expenseId?: string;
		returnTo?: string;
		preselectedVehicleId?: string | null;
		preselectedCategory?: string | null;
		preselectedFinancingId?: string | null;
		preselectedAmount?: string | null;
		preselectedDescription?: string | null;
		preselectedTags?: string | null;
		queuedExpenseId?: string | null;
	}

	let {
		expenseId,
		queuedExpenseId = null,
		returnTo = '/expenses',
		preselectedVehicleId = null,
		preselectedCategory = null,
		preselectedFinancingId = null,
		preselectedAmount = null,
		preselectedDescription = null,
		preselectedTags = null
	}: Props = $props();

	const ctx: ExpenseFormContext = {
		get expenseId() {
			return expenseId;
		},
		get returnTo() {
			return returnTo;
		}
	};

	const form = new ExpenseFormState(
		ctx,
		untrack(() => !!expenseId || !!queuedExpenseId)
	);

	let previousVehicleId = $state('');
	$effect(() => {
		if (
			form.formData.vehicleId &&
			form.formData.vehicleId !== previousVehicleId &&
			!form.vehiclesError
		) {
			previousVehicleId = form.formData.vehicleId;
			if (form.vehicle !== null || !form.isLoading) {
				if (
					(!form.isEditMode || form.vehicle !== null) &&
					form.formData.vehicleId !== form.queuedExpense?.vehicleId
				) {
					form.sourceType = null;
					form.sourceId = null;
				}
				loadVehicleContext(form);
			}
		}
	});

	onMount(() =>
		trackPendingSave(
			() =>
				form.isSubmitting &&
				(form.isEditMode || (form.isSplit && form.selectedVehicleIds.length >= 2))
		)
	);

	onMount(async () => {
		await settingsStore.load();
		await loadVehicles(form);

		if (form.isEditMode && expenseId) {
			await loadExpense(form);
		} else if (queuedExpenseId) {
			await loadQueuedExpense(form, queuedExpenseId);
			form.isLoading = false;
		} else {
			applyPreselections(form, {
				vehicleId: preselectedVehicleId,
				category: preselectedCategory,
				amount: preselectedAmount,
				description: preselectedDescription,
				tags: preselectedTags
			});
		}

		if (form.formData.vehicleId && !form.vehiclesError) {
			await loadVehicleContext(form);
		}

		if (!form.isEditMode && preselectedFinancingId) {
			form.sourceType = 'financing';
			form.sourceId = preselectedFinancingId;
		}
	});

	let isRetrying = $state(false);
	let retryButton = $state<HTMLButtonElement | null>(null);

	const formTitle = $derived(
		form.isGroupEditMode
			? 'Edit Split Expense'
			: form.isEditMode
				? 'Edit Expense'
				: form.queuedExpense
					? 'Edit Queued Expense'
					: 'Add Expense'
	);

	async function save() {
		await (form.queuedExpense ? saveQueuedExpense(form) : submitExpense(form));
		if (form.errors['vehicleDetails'] && retryButton) {
			retryButton.scrollIntoView({ block: 'center' });
			retryButton.focus({ preventScroll: true });
		}
	}

	async function retry(load: () => Promise<void>) {
		isRetrying = true;
		try {
			await load();
		} finally {
			isRetrying = false;
		}
	}

	async function reloadExpense() {
		await loadExpense(form);
		if (form.formData.vehicleId && !form.vehiclesError && !form.expenseError) {
			await loadVehicleContext(form);
		}
	}

	function handleReceiptDraft(draft: ReceiptDraft, image: File) {
		if (draft.category) form.selectCategory(draft.category);
		if (typeof draft.amount === 'number') form.formData.amount = String(draft.amount);
		if (draft.date) form.formData.date = draft.date;
		if (typeof draft.odometer === 'number') form.formData.mileage = String(draft.odometer);
		if (draft.vendor && !form.formData.description.trim()) {
			form.formData.description = draft.vendor;
		}
		form.pendingFiles = [...form.pendingFiles, image];
		appStore.showSuccess('Receipt scanned — review the details and save.');
	}

	function handleBack() {
		gotoDynamic(returnTo);
	}

	function handleDuplicate() {
		gotoWithQuery(resolve(routes.expenseNew), buildDuplicateQuery(returnTo, form.formData));
	}

	function confirmDelete() {
		form.showDeleteConfirm = true;
	}

	const photoEntityIdForInsurance = $derived(
		form.groupId && form.originalExpense ? form.originalExpense.id : null
	);
</script>

<FormLayout>
	{#if form.isLoading}
		<div class="flex items-center justify-center py-12">
			<LoaderCircle class="h-8 w-8 animate-spin text-primary" />
		</div>
	{:else if form.expenseError}
		<div class="space-y-6">
			<ExpenseFormHeader title="Edit Expense" onBack={handleBack} />
			<div class="rounded-lg border bg-card p-6" role="alert" data-testid="expense-load-error">
				<div class="mb-4 flex items-center gap-3 text-destructive">
					<CircleAlert class="h-5 w-5" />
					<p class="font-medium">
						Couldn't load this {form.groupId ? 'split expense' : 'expense'}
					</p>
				</div>
				<p class="mb-4 text-sm text-muted-foreground">{form.expenseError}</p>
				<Button size="lg" disabled={isRetrying} onclick={() => retry(reloadExpense)}>Retry</Button>
			</div>
		</div>
	{:else if form.isInsuranceManaged}
		<InsuranceManagedView
			category={form.formData.category}
			amount={form.formData.amount}
			date={form.formData.date}
			description={form.formData.description}
			tags={form.formData.tags}
			photoEntityId={photoEntityIdForInsurance}
			isDeleting={form.isDeleting}
			onBack={handleBack}
			onForceDelete={confirmDelete}
		/>
	{:else if form.vehiclesError}
		<div class="space-y-6">
			<ExpenseFormHeader title={formTitle} onBack={handleBack}>
				{#snippet subtitle()}
					<ExpenseFormSubtitle
						isEditMode={form.isEditMode}
						isGroupEditMode={form.isGroupEditMode}
						selectedVehicleIds={form.selectedVehicleIds}
						vehicles={form.vehicles}
						vehicle={form.vehicle}
					/>
				{/snippet}
			</ExpenseFormHeader>
			<div class="rounded-lg border bg-card p-6" role="alert" data-testid="vehicles-load-error">
				<div class="mb-4 flex items-center gap-3 text-destructive">
					<CircleAlert class="h-5 w-5" />
					<p class="font-medium">Couldn't load your vehicles</p>
				</div>
				<p class="mb-4 text-sm text-muted-foreground">{form.vehiclesError}</p>
				<Button size="lg" disabled={isRetrying} onclick={() => retry(() => loadVehicles(form))}>
					Retry
				</Button>
			</div>
		</div>
	{:else}
		<div class="space-y-6 pb-32 sm:pb-24">
			<ExpenseFormHeader title={formTitle} onBack={handleBack}>
				{#snippet subtitle()}
					<ExpenseFormSubtitle
						isEditMode={form.isEditMode}
						isGroupEditMode={form.isGroupEditMode}
						selectedVehicleIds={form.selectedVehicleIds}
						vehicles={form.vehicles}
						vehicle={form.vehicle}
					/>
				{/snippet}
			</ExpenseFormHeader>

			<form
				onsubmit={e => {
					e.preventDefault();
					save();
				}}
				class="rounded-lg border bg-card p-6 space-y-6"
			>
				{#if !form.isEditMode && !form.isSplit && !form.isInsuranceManaged && !form.queuedExpense}
					<ReceiptScanButton onDraft={handleReceiptDraft} />
				{/if}

				{#if form.queuedExpense}
					<div
						class="flex items-start gap-3 rounded-lg border bg-muted/50 p-4"
						data-testid="queued-edit-note"
					>
						<TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 text-warning" />
						<div class="space-y-1 text-sm text-foreground">
							<p class="font-medium">This entry couldn't sync.</p>
							{#if form.queuedExpense.attentionReason}
								<p>{form.queuedExpense.attentionReason}</p>
							{/if}
							<p class="text-muted-foreground">
								Fix it here and save, and it goes back in the queue to sync.
							</p>
						</div>
					</div>
				{/if}

				{#if form.isGroupEditMode}
					<div
						class="flex items-start gap-3 rounded-lg border bg-muted/50 p-4"
						data-testid="split-edit-note"
					>
						<Info class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
						<p class="text-sm text-foreground">
							You can change the vehicles and amounts of a split here. To change its date, category,
							mileage, description, location or tags, delete the split and add it again.
						</p>
					</div>
				{/if}

				{#if form.isSplit}
					<SplitVehiclePicker
						vehicles={form.vehicles}
						selectedVehicleIds={form.selectedVehicleIds}
						showRemove={!form.isEditMode}
						onToggle={form.handleSplitVehicleToggle}
						onRemoveSplit={() => form.handleSplitToggle(false)}
					/>
				{:else}
					<div class="space-y-2">
						<VehicleSelectField
							vehicles={form.vehicles}
							value={form.formData.vehicleId}
							error={form.touched['vehicleId'] ? form.errors['vehicleId'] : undefined}
							describedBy={form.showFuelSplitHint ? 'fuel-split-hint' : undefined}
							canSplit={form.canSplit}
							onSelect={form.handleVehicleSelect}
							onSplit={() => form.handleSplitToggle(true)}
						/>
						{#if form.showFuelSplitHint}
							<p
								id="fuel-split-hint"
								class="text-xs text-muted-foreground"
								data-testid="fuel-split-hint"
							>
								Fill-ups can't be split across vehicles. Log each one on the vehicle you filled.
							</p>
						{/if}
						{#if form.vehicleError}
							<div class="space-y-2 text-sm" role="alert" data-testid="vehicle-load-error">
								<p id="vehicle-load-message" class="flex items-start gap-2 text-destructive">
									<CircleAlert class="mt-0.5 h-4 w-4 shrink-0" />
									{form.showFuelFields
										? FUEL_NEEDS_VEHICLE_MESSAGE
										: "Couldn't load this vehicle's details."}
								</p>
								<Button
									bind:ref={retryButton}
									variant="outline"
									size="lg"
									aria-describedby="vehicle-load-message"
									disabled={isRetrying}
									onclick={() => retry(() => loadVehicleContext(form))}
								>
									Retry
								</Button>
							</div>
						{/if}
					</div>
				{/if}

				<fieldset
					disabled={form.isGroupEditMode}
					class="min-w-0 disabled:[&_button]:cursor-not-allowed disabled:[&_button]:opacity-50"
				>
					<CategorySelector
						value={form.formData.category}
						error={form.errors['category']}
						touched={form.touched['category']}
						onSelect={form.selectCategory}
					/>
				</fieldset>

				{#if form.isFinancingPayment}
					<div class="flex items-center gap-3 rounded-lg border bg-muted/50 p-4">
						<CreditCard class="h-4 w-4 text-chart-3" />
						<span class="text-sm font-medium leading-none text-foreground">
							Financing payment
						</span>
					</div>
				{/if}

				<ExpenseDateAmountFields
					bind:date={form.formData.date}
					bind:amount={form.formData.amount}
					dateError={form.touched['date'] ? form.errors['date'] : undefined}
					amountError={form.touched['amount'] ? form.errors['amount'] : undefined}
					dateDisabled={form.isGroupEditMode}
					onAmountBlur={() => form.handleBlur('amount')}
				/>

				{#if form.isSplit && form.selectedVehicleIds.length >= 2 && form.parsedTotalAmount > 0}
					<ExpenseSplitBreakdown
						vehicles={form.selectedVehicleIds.flatMap(
							id => form.vehicles.find(v => v.id === id) ?? []
						)}
						totalAmount={form.parsedTotalAmount}
						splitMethod={form.splitMethod}
						allocations={form.splitAllocations}
						onMethodChange={form.handleMethodChange}
						onAllocationsChange={form.handleAllocationsChange}
					/>
				{/if}

				<fieldset
					disabled={form.isGroupEditMode}
					class="min-w-0 space-y-6 disabled:[&_button]:cursor-not-allowed disabled:[&_button]:opacity-50"
				>
					{#if form.isSplit && form.selectedVehicleIds.length >= 2}
						<SplitMileageReadings
							vehicles={form.vehicles}
							selectedVehicleIds={form.selectedVehicleIds}
							mileages={form.splitMileages}
							bind:open={form.showPerVehicleMileage}
							onMileageInput={(vid, value) => (form.splitMileages[vid] = value)}
						/>
					{:else}
						<MileageField
							bind:value={form.formData.mileage}
							required={form.showFuelFields}
							error={form.touched['mileage'] ? form.errors['mileage'] : undefined}
							previousFuelMileage={form.previousFuelHint}
							distanceLabel={form.distLabel}
							onInput={form.handleMileageChange}
							onBlur={() => form.handleBlur('mileage')}
						/>
					{/if}

					{#if form.showFuelFields && form.vehicle}
						<FuelFieldsSection
							trackFuel={form.vehicle.trackFuel}
							trackCharging={form.vehicle.trackCharging}
							bind:volume={form.formData.volume}
							bind:charge={form.formData.charge}
							bind:fuelType={form.formData.fuelType}
							bind:missedFillup={form.formData.missedFillup}
							amount={form.formData.amount}
							volumeUnit={form.effectiveVolumeUnit}
							chargeUnit={form.effectiveChargeUnit}
							distanceUnit={form.effectiveDistanceUnit}
							calculatedMpg={form.calculatedMpg}
							calculatedEfficiency={form.calculatedEfficiency}
							showMpgCalculation={form.showMpgCalculation && !form.formData.missedFillup}
							errors={form.errors}
							touched={form.touched}
							onBlur={form.handleBlur}
							onMileageChange={form.handleMileageChange}
						/>
					{/if}

					<ExpenseNotesFields
						bind:description={form.formData.description}
						bind:location={form.formData.location}
						bind:tags={form.formData.tags}
						tagError={form.errors['tags']}
						tagTouched={form.touched['tags']}
						tagSuggestions={form.tagSuggestions}
					/>
				</fieldset>

				{#if form.isEditMode}
					{#if form.originalExpense}
						<ExpensePhotoSection entityType="expense" entityId={form.originalExpense.id} />
					{/if}
				{:else}
					<PendingPhotoPreview
						files={form.pendingFiles}
						onAdd={file => (form.pendingFiles = [...form.pendingFiles, file])}
						onRemove={i => (form.pendingFiles = form.pendingFiles.filter((_, idx) => idx !== i))}
					/>
				{/if}

				{#if form.submitError}
					<FormFieldError data-testid="submit-error" class="rounded-md bg-destructive/10 p-3">
						{form.submitError}
					</FormFieldError>
				{/if}
			</form>

			<ExpenseActionBar
				isEditMode={form.isEditMode}
				canDuplicate={form.canDuplicate}
				isSubmitting={form.isSubmitting}
				isDeleting={form.isDeleting}
				onDelete={confirmDelete}
				onDuplicate={handleDuplicate}
				onCancel={handleBack}
				onSave={save}
			/>
		</div>
	{/if}

	<ExpenseDeleteDialog
		bind:open={form.showDeleteConfirm}
		isInsuranceManaged={form.isInsuranceManaged}
		isGroupEditMode={form.isGroupEditMode}
		groupId={form.groupId}
		originalExpense={form.originalExpense}
		isDeleting={form.isDeleting}
		onConfirm={() => deleteExpense(form)}
	/>
</FormLayout>
