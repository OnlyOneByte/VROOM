<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { routes } from '#lib/routes.ts';
	import { gotoDynamic, gotoWithQuery } from '#lib/utils/navigation.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { LoaderCircle, CreditCard } from '@lucide/svelte';
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
		type ExpenseFormContext
	} from './expense-form/expense-form-state.svelte';
	import {
		applyPreselections,
		loadAllVehicleExpenses,
		loadExpense,
		loadLastFuelExpense,
		loadVehicle,
		loadVehicleContext,
		loadVehicles
	} from './expense-form/expense-form-loaders';
	import { deleteExpense, submitExpense } from './expense-form/expense-form-actions';
	import { buildDuplicateQuery, buildInsuranceEditQuery } from './expense-form/expense-navigation';
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
	}

	let {
		expenseId,
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

	const form = new ExpenseFormState(ctx, !!expenseId);

	let previousVehicleId = $state('');
	$effect(() => {
		if (form.formData.vehicleId && form.formData.vehicleId !== previousVehicleId) {
			previousVehicleId = form.formData.vehicleId;
			if (form.vehicle !== null || !form.isLoading) {
				if (!form.isEditMode || form.vehicle !== null) {
					form.sourceType = null;
					form.sourceId = null;
				}
				loadVehicle(form);
				loadLastFuelExpense(form);
				loadAllVehicleExpenses(form);
			}
		}
	});

	onMount(async () => {
		await settingsStore.load();
		await loadVehicles(form);

		if (form.isEditMode && expenseId) {
			await loadExpense(form);
		} else {
			applyPreselections(form, {
				vehicleId: preselectedVehicleId,
				category: preselectedCategory,
				amount: preselectedAmount,
				description: preselectedDescription,
				tags: preselectedTags
			});
		}

		if (form.formData.vehicleId) {
			await loadVehicleContext(form);
		}

		if (!form.isEditMode && preselectedFinancingId) {
			form.sourceType = 'financing';
			form.sourceId = preselectedFinancingId;
		}
	});

	function handleReceiptDraft(draft: ReceiptDraft, image: File) {
		if (typeof draft.amount === 'number') form.formData.amount = String(draft.amount);
		if (draft.date) form.formData.date = draft.date;
		if (typeof draft.odometer === 'number') form.formData.mileage = String(draft.odometer);
		if (draft.category) form.selectCategory(draft.category);
		if (draft.vendor && !form.formData.description.trim()) {
			form.formData.description = draft.vendor;
		}
		form.pendingFiles = [...form.pendingFiles, image];
		appStore.showSuccess('Receipt scanned — review the details and save.');
	}

	function handleBack() {
		gotoDynamic(returnTo);
	}

	function handleEditInsuranceTerm() {
		gotoWithQuery(
			resolve(routes.insurance),
			buildInsuranceEditQuery(form.insurancePolicyId, form.sourceType, form.sourceId)
		);
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
	{:else if form.isInsuranceManaged}
		<InsuranceManagedView
			category={form.formData.category}
			amount={form.formData.amount}
			date={form.formData.date}
			description={form.formData.description}
			tags={form.formData.tags}
			policyId={form.insurancePolicyId}
			photoEntityId={photoEntityIdForInsurance}
			isDeleting={form.isDeleting}
			onBack={handleBack}
			onEditTerm={handleEditInsuranceTerm}
			onForceDelete={confirmDelete}
		/>
	{:else}
		<div class="space-y-6 pb-32 sm:pb-24">
			<ExpenseFormHeader
				title={form.isGroupEditMode
					? 'Edit Split Expense'
					: form.isEditMode
						? 'Edit Expense'
						: 'Add Expense'}
				onBack={handleBack}
			>
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
					submitExpense(form);
				}}
				class="rounded-lg border bg-card p-6 space-y-6"
			>
				{#if !form.isEditMode && !form.isSplit && !form.isInsuranceManaged}
					<ReceiptScanButton onDraft={handleReceiptDraft} />
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
					<VehicleSelectField
						vehicles={form.vehicles}
						value={form.formData.vehicleId}
						error={form.touched['vehicleId'] ? form.errors['vehicleId'] : undefined}
						canSplit={(!form.isEditMode || form.isGroupEditMode) && form.vehicles.length >= 2}
						onSelect={form.handleVehicleSelect}
						onSplit={() => form.handleSplitToggle(true)}
					/>
				{/if}

				<CategorySelector
					value={form.formData.category}
					error={form.errors['category']}
					touched={form.touched['category']}
					onSelect={form.selectCategory}
				/>

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
					onAmountBlur={() => form.handleBlur('amount')}
				/>

				{#if form.isSplit && form.selectedVehicleIds.length >= 2 && form.parsedTotalAmount > 0}
					<ExpenseSplitBreakdown
						vehicles={form.vehicles.filter(v => form.selectedVehicleIds.includes(v.id))}
						totalAmount={form.parsedTotalAmount}
						splitMethod={form.splitMethod}
						allocations={form.splitAllocations}
						onMethodChange={form.handleMethodChange}
						onAllocationsChange={form.handleAllocationsChange}
					/>
				{/if}

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
						volumeUnit={form.volumeUnit}
						chargeUnit={form.chargeUnit}
						distanceUnit={form.distanceUnit}
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

				{#if form.isGroupEditMode && form.groupId && form.originalExpense}
					<ExpensePhotoSection entityType="expense" entityId={form.originalExpense.id} />
				{:else if form.isEditMode && expenseId}
					<ExpensePhotoSection entityType="expense" entityId={expenseId} />
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
				onSave={() => submitExpense(form)}
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
