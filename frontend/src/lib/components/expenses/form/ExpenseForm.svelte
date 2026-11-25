<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import {
		focusFirstButton,
		focusFirstProblem,
		focusInView,
		focusLeftOn
	} from '#lib/utils/focus.ts';
	import { resolve } from '$app/paths';
	import { routes } from '#lib/routes.ts';
	import { gotoDynamic, gotoWithQuery } from '#lib/utils/navigation.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { trackPendingSave } from '#lib/utils/pending-saves.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { onlineStatus } from '#lib/stores/offline.svelte.ts';
	import { dateOnlyToISO, formatDate, toDateInputValue } from '#lib/utils/formatters.ts';
	import {
		LoaderCircle,
		CreditCard,
		Info,
		CircleAlert,
		TriangleAlert,
		ChevronDown
	} from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import {
		Collapsible,
		CollapsibleContent,
		CollapsibleTrigger
	} from '#lib/components/ui/collapsible/index.ts';
	import DatePicker from '#lib/components/common/date-picker.svelte';
	import NoVehiclesEmptyState from '#lib/components/common/NoVehiclesEmptyState.svelte';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import CategorySelector from './CategorySelector.svelte';
	import FuelFieldsSection, { type EnergyMode } from './FuelFieldsSection.svelte';
	import FuelTypeFields from './FuelTypeFields.svelte';
	import ExpensePhotoSection from './ExpensePhotoSection.svelte';
	import PendingPhotoPreview from './PendingPhotoPreview.svelte';
	import ReceiptScanButton from './ReceiptScanButton.svelte';
	import { convertVolume } from './expense-form/mileage-efficiency';
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
		loadQueuedPhotos,
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
	import ExpenseFormHeader from './expense-form/ExpenseFormHeader.svelte';
	import ExpenseActionBar from './expense-form/ExpenseActionBar.svelte';
	import ExpenseSaveRow from './expense-form/ExpenseSaveRow.svelte';
	import ExpenseDeleteDialog from './expense-form/ExpenseDeleteDialog.svelte';
	import ExpenseAmountField from './expense-form/ExpenseAmountField.svelte';
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

	let vehiclesLoaded = $state(false);
	const needsVehicle = $derived(
		vehiclesLoaded && form.vehicles.length === 0 && !form.isEditMode && !form.queuedExpense
	);

	let previousVehicleId = $state('');
	let mounted = $state(false);
	$effect(() => {
		if (
			mounted &&
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
		vehiclesLoaded = true;

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

		const loadsContext = !!form.formData.vehicleId && !form.vehiclesError;
		if (loadsContext) previousVehicleId = form.formData.vehicleId;
		mounted = true;
		detailsOpen = form.isEditMode || !!form.queuedExpense || hasDetailValues();
		if (!form.isEditMode && !form.queuedExpense) {
			await tick();
			amountInput?.focus();
		}
		if (loadsContext) await loadVehicleContext(form);

		if (!form.isEditMode && preselectedFinancingId) {
			form.sourceType = 'financing';
			form.sourceId = preselectedFinancingId;
		}
	});

	const showsOdometerCheckDeferred = $derived(
		form.historyCheckDeferred && form.showFuelFields && !form.vehicleError
	);
	let isRetrying = $state(false);
	let retryButton = $state<HTMLButtonElement | null>(null);
	let formEl = $state<HTMLFormElement | null>(null);
	let amountInput = $state<HTMLInputElement | null>(null);
	const notesFields = import('./expense-form/ExpenseNotesFields.svelte');
	let energyMode = $state<EnergyMode>('fuel');
	let detailsOpen = $state(false);

	const quickActions = $derived(!form.isEditMode);
	const showsSubtitle = $derived(form.isEditMode || !!form.queuedExpense || !onlineStatus.current);
	const dateLabel = $derived(
		form.formData.date === toDateInputValue(new Date())
			? 'Today'
			: form.formData.date
				? formatDate(dateOnlyToISO(form.formData.date))
				: undefined
	);
	const canScanReceipt = $derived(
		!form.isEditMode && !form.isSplit && !form.isInsuranceManaged && !form.queuedExpense
	);
	const vehicleError = $derived(form.touched['vehicleId'] ? form.errors['vehicleId'] : undefined);
	const dateError = $derived(form.touched['date'] ? form.errors['date'] : undefined);
	const detailFields = $derived([
		'description',
		'location',
		'tags',
		'fuelType',
		...(form.showFuelFields ? [] : ['mileage'])
	]);
	const detailsSummary = $derived.by(() => {
		const lead = form.showFuelFields
			? energyMode === 'charging'
				? 'Charging type'
				: 'Fuel type'
			: form.asksForMileage
				? 'Odometer'
				: 'Where';
		const rest = form.showFuelFields || form.asksForMileage ? ['where'] : [];
		return [lead, ...rest, 'note', 'tags', 'receipt'].join(', ');
	});

	function handleAmountBlur() {
		const { amount } = form.formData;
		if ((amount != null && amount !== '') || form.touched['amount']) form.handleBlur('amount');
	}

	function hasDetailValues(): boolean {
		const { description, location, tags, mileage, missedFillup } = form.formData;
		return (
			!!description ||
			!!location ||
			tags.length > 0 ||
			missedFillup ||
			form.pendingFiles.length > 0 ||
			(!form.showFuelFields && !!mileage)
		);
	}

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
		if (form.errors['vehicleDetails']) {
			focusInView(retryButton);
			return;
		}
		const failed = Object.keys(form.errors);
		if (!form.submitError && failed.length === 0) return;
		if (failed.some(field => detailFields.includes(field))) detailsOpen = true;
		await focusFirstProblem(formEl);
	}

	async function retry(load: () => Promise<void>) {
		if (isRetrying) return;
		isRetrying = true;
		try {
			await load();
		} finally {
			isRetrying = false;
		}
	}

	let photoPicker = $state<HTMLDivElement | null>(null);
	let photosRetryFailed = $state(false);

	async function retryVehicleContext() {
		const origin = document.activeElement;
		await retry(() => loadVehicleContext(form));
		if (form.vehicleError) return;
		await tick();
		if (focusLeftOn(origin)) document.getElementById('vehicle')?.focus();
	}

	async function retryQueuedPhotos(clientId: string) {
		if (isRetrying) return;
		const origin = document.activeElement;
		photosRetryFailed = false;
		await tick();
		await retry(() => loadQueuedPhotos(form, clientId));
		photosRetryFailed = form.queuedPhotosUnreadable;
		if (photosRetryFailed) return;
		await tick();
		if (focusLeftOn(origin)) focusFirstButton(photoPicker);
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
		if (typeof draft.volume === 'number' && draft.volumeUnit) {
			form.formData.volume = String(
				convertVolume(draft.volume, draft.volumeUnit, form.effectiveVolumeUnit)
			);
		}
		if (draft.vendor && !form.formData.description.trim()) {
			form.formData.description = draft.vendor;
		}
		form.pendingFiles = [...form.pendingFiles, image];
		detailsOpen = true;
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

{#snippet mileageField()}
	<MileageField
		bind:value={form.formData.mileage}
		required={form.showFuelFields}
		error={form.touched['mileage'] ? form.errors['mileage'] : undefined}
		previousFuelMileage={form.previousFuelHint}
		distanceLabel={form.distLabel}
		describedBy={showsOdometerCheckDeferred ? 'odometer-check-deferred' : undefined}
		onInput={form.handleMileageChange}
		onBlur={() => form.handleBlur('mileage')}
	/>
{/snippet}

{#snippet formSubtitle()}
	{#if form.queuedExpense}
		Saved on this device, waiting to sync
	{:else}
		<ExpenseFormSubtitle
			isEditMode={form.isEditMode}
			isGroupEditMode={form.isGroupEditMode}
			selectedVehicleIds={form.selectedVehicleIds}
			vehicles={form.vehicles}
			vehicle={form.vehicle}
		/>
	{/if}
{/snippet}

{#snippet createHeader()}
	<ExpenseFormHeader
		title={formTitle}
		onBack={handleBack}
		subtitle={showsSubtitle ? formSubtitle : undefined}
	/>
{/snippet}

<FormLayout>
	{#if form.isLoading}
		<div class="flex items-center justify-center py-12">
			<LoaderCircle class="h-8 w-8 animate-spin text-primary" />
		</div>
	{:else if !vehiclesLoaded}
		<div class="space-y-6" aria-busy="true" data-testid="expense-form-skeleton">
			{@render createHeader()}
			<div class="space-y-6 rounded-lg border bg-card p-6">
				<Skeleton class="h-10 w-full sm:h-9" />
				<div class="space-y-2">
					<Skeleton class="h-4 w-20" />
					<Skeleton class="h-10 w-full" />
				</div>
				<div class="space-y-2">
					<Skeleton class="h-4 w-24" />
					<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
						{#each Array(6) as _, i (i)}
							<Skeleton class="h-28 w-full" />
						{/each}
					</div>
				</div>
			</div>
		</div>
	{:else if form.expenseError}
		<div class="space-y-6">
			<ExpenseFormHeader title="Edit Expense" onBack={handleBack} />
			<LoadErrorCard
				data-testid="expense-load-error"
				title="Couldn't load this {form.groupId ? 'split expense' : 'expense'}"
				message={form.expenseError}
				onRetry={() => retry(reloadExpense)}
			/>
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
			<ExpenseFormHeader
				title={formTitle}
				onBack={handleBack}
				subtitle={showsSubtitle ? formSubtitle : undefined}
			/>
			<LoadErrorCard
				data-testid="vehicles-load-error"
				title="Couldn't load your vehicles"
				message={form.vehiclesError}
				onRetry={() => retry(() => loadVehicles(form))}
			/>
		</div>
	{:else if needsVehicle}
		<div class="space-y-6">
			{@render createHeader()}
			<NoVehiclesEmptyState
				description="Every expense belongs to a vehicle. Add one, then log what you spend on it."
			/>
		</div>
	{:else}
		<div class="space-y-6 {quickActions ? '' : 'pb-32 sm:pb-24 lg:pb-0 short:pb-0'}">
			<ExpenseFormHeader
				title={formTitle}
				onBack={handleBack}
				subtitle={showsSubtitle ? formSubtitle : undefined}
			/>

			<form
				bind:this={formEl}
				novalidate
				onsubmit={e => {
					e.preventDefault();
					save();
				}}
				class="space-y-5 sm:rounded-lg sm:border sm:bg-card sm:p-6"
			>
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
				{/if}

				<div class="space-y-2">
					<div class="flex flex-wrap items-center gap-2">
						{#if !form.isSplit}
							<VehicleSelectField
								vehicles={form.vehicles}
								value={form.formData.vehicleId}
								error={vehicleError}
								describedBy={form.showFuelSplitHint ? 'fuel-split-hint' : undefined}
								canSplit={form.canSplit}
								onSelect={form.handleVehicleSelect}
								onSplit={() => form.handleSplitToggle(true)}
							/>
						{/if}
						<Label for="date" class="sr-only">Date *</Label>
						<DatePicker
							id="date"
							bind:value={form.formData.date}
							placeholder="Select date"
							label={dateLabel}
							disabled={form.isGroupEditMode}
							class="h-10 w-auto rounded-full px-3.5"
							aria-invalid={!!dateError}
							aria-describedby={dateError ? 'date-error' : undefined}
						/>
						{#if canScanReceipt}
							<ReceiptScanButton onDraft={handleReceiptDraft} />
						{/if}
					</div>
					{#if vehicleError}
						<FormFieldError id="vehicleId-error">{vehicleError}</FormFieldError>
					{/if}
					{#if dateError}
						<FormFieldError id="date-error">{dateError}</FormFieldError>
					{/if}
					{#if !form.isSplit}
						{#if form.showFuelSplitHint}
							<p
								id="fuel-split-hint"
								class="text-xs text-muted-foreground"
								data-testid="fuel-split-hint"
							>
								Fill-ups can't be split across vehicles. Log each one on the vehicle you filled.
							</p>
						{/if}
						{#if showsOdometerCheckDeferred}
							<p
								id="odometer-check-deferred"
								class="text-xs text-muted-foreground"
								data-testid="odometer-check-deferred"
							>
								This vehicle's past entries aren't on this device, so the odometer reading is
								checked when this entry syncs. If it doesn't fit, the entry waits under Needs
								attention for you to fix.
							</p>
						{/if}
						{#if form.vehicleError}
							<div class="space-y-2 text-sm" role="alert" data-testid="vehicle-load-error">
								<p id="vehicle-load-message" class="flex items-start gap-2 text-destructive">
									<CircleAlert class="mt-0.5 h-4 w-4 shrink-0" />
									<span>
										{form.showFuelFields
											? FUEL_NEEDS_VEHICLE_MESSAGE
											: "Couldn't load this vehicle's details."}
										{form.vehicleError}
									</span>
								</p>
								<Button
									bind:ref={retryButton}
									variant="outline"
									size="lg"
									aria-describedby="vehicle-load-message"
									aria-disabled={isRetrying}
									onclick={retryVehicleContext}
								>
									Retry
								</Button>
							</div>
						{/if}
					{/if}
				</div>

				<ExpenseAmountField
					bind:ref={amountInput}
					bind:amount={form.formData.amount}
					amountError={form.touched['amount'] ? form.errors['amount'] : undefined}
					onAmountBlur={handleAmountBlur}
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
					class="min-w-0 space-y-5 disabled:[&_button]:cursor-not-allowed disabled:[&_button]:opacity-50"
				>
					<CategorySelector
						value={form.formData.category}
						disabledValues={form.isSplit && !form.isGroupEditMode ? ['fuel'] : []}
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

					{#if form.showFuelFields && form.vehicle}
						<FuelFieldsSection
							trackFuel={form.vehicle.trackFuel}
							trackCharging={form.vehicle.trackCharging}
							bind:volume={form.formData.volume}
							bind:charge={form.formData.charge}
							bind:fuelType={form.formData.fuelType}
							bind:energyMode
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
						>
							{#snippet odometer()}
								{#if form.asksForMileage}
									{@render mileageField()}
								{/if}
							{/snippet}
						</FuelFieldsSection>
					{:else if form.showFuelFields && form.asksForMileage}
						{@render mileageField()}
					{/if}
				</fieldset>

				<Collapsible bind:open={detailsOpen}>
					<CollapsibleTrigger
						class="flex min-h-12 w-full items-center justify-between gap-3 rounded-md border bg-background px-3 text-left text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
					>
						<span class="shrink-0">More details</span>
						<span class="flex min-w-0 items-center gap-1 text-xs font-normal text-muted-foreground">
							<span class="truncate">{detailsSummary}</span>
							<ChevronDown
								class="size-4 shrink-0 transition-transform {detailsOpen ? 'rotate-180' : ''}"
								aria-hidden="true"
							/>
						</span>
					</CollapsibleTrigger>
					<CollapsibleContent class="space-y-5 pt-5">
						<fieldset
							disabled={form.isGroupEditMode}
							class="min-w-0 space-y-5 disabled:[&_button]:cursor-not-allowed disabled:[&_button]:opacity-50"
						>
							{#if !form.showFuelFields && form.asksForMileage}
								{@render mileageField()}
							{/if}

							{#if form.showFuelFields && form.vehicle}
								{#key energyMode}
									<FuelTypeFields
										{energyMode}
										bind:fuelType={form.formData.fuelType}
										bind:missedFillup={form.formData.missedFillup}
										onBlur={form.handleBlur}
									/>
								{/key}
							{/if}

							{#await notesFields then { default: ExpenseNotesFields }}
								<ExpenseNotesFields
									bind:description={form.formData.description}
									bind:location={form.formData.location}
									bind:tags={form.formData.tags}
									tagError={form.errors['tags']}
									tagTouched={form.touched['tags']}
									tagSuggestions={form.tagSuggestions}
								/>
							{/await}
						</fieldset>

						{#if form.isEditMode}
							{#if form.originalExpense}
								<ExpensePhotoSection entityType="expense" entityId={form.originalExpense.id} />
							{/if}
						{:else if form.queuedPhotosUnreadable && form.queuedExpense?.clientId}
							{@const clientId = form.queuedExpense.clientId}
							<div class="space-y-2" data-testid="queued-photos-unreadable">
								<h2 class="text-sm font-medium text-foreground">Photos & Receipts</h2>
								<p id="queued-photos-message" class="text-sm text-muted-foreground">
									Couldn't load this entry's photos, so they can't be changed here. They stay saved
									with it and will sync as they are.
								</p>
								<Button
									variant="outline"
									size="lg"
									aria-describedby="queued-photos-message"
									aria-disabled={isRetrying}
									onclick={() => retryQueuedPhotos(clientId)}
								>
									Retry
								</Button>
								<p role="status" class="min-h-5 text-sm text-muted-foreground">
									{#if photosRetryFailed}Still couldn't load them. Try again in a moment.{/if}
								</p>
							</div>
						{:else}
							<div bind:this={photoPicker}>
								<PendingPhotoPreview
									files={form.pendingFiles}
									onAdd={file => (form.pendingFiles = [...form.pendingFiles, file])}
									onRemove={i =>
										(form.pendingFiles = form.pendingFiles.filter((_, idx) => idx !== i))}
								/>
							</div>
						{/if}
					</CollapsibleContent>
				</Collapsible>

				{#if form.submitError}
					<FormFieldError
						id="submit-error"
						data-testid="submit-error"
						tabindex={-1}
						class="rounded-md bg-destructive/10 p-3"
					>
						{form.submitError}
					</FormFieldError>
				{/if}

				{#if quickActions}
					<ExpenseSaveRow isSubmitting={form.isSubmitting} onCancel={handleBack} />
				{/if}
			</form>

			{#if !quickActions}
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
			{/if}
		</div>
	{/if}

	<ExpenseDeleteDialog
		bind:open={form.showDeleteConfirm}
		isInsuranceManaged={form.isInsuranceManaged}
		isGroupEditMode={form.isGroupEditMode}
		groupId={form.groupId}
		originalExpense={form.originalExpense}
		onConfirm={() => deleteExpense(form)}
	/>
</FormLayout>
