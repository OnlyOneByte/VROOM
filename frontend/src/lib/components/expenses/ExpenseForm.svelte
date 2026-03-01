<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { isOnline } from '$lib/stores/offline';
	import { addOfflineExpense } from '$lib/utils/offline-storage';
	import { requestBackgroundSync } from '$lib/utils/pwa';
	import { appStore } from '$lib/stores/app';
	import { settingsStore } from '$lib/stores/settings';
	import { expenseApi } from '$lib/services/expense-api';
	import { vehicleApi } from '$lib/services/vehicle-api';
	import { Save, ArrowLeft, Gauge, Check, X, Trash2 } from 'lucide-svelte';
	import { LoaderCircle } from 'lucide-svelte';
	import DatePicker from '$lib/components/ui/date-picker.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Select from '$lib/components/ui/select';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button } from '$lib/components/ui/button';
	import { FormFieldError } from '$lib/components/ui/form-field';
	import CategorySelector from './CategorySelector.svelte';
	import FuelFieldsSection from './FuelFieldsSection.svelte';
	import TagInput from './TagInput.svelte';
	import { validateExpenseField } from './expense-form-validation';
	import type { ExpenseFormErrors, Vehicle, Expense } from '$lib/types.js';
	import { usesLiquidFuel, usesElectricCharge } from '$lib/utils/units';

	interface Props {
		expenseId?: string;
		returnTo?: string;
		preselectedVehicleId?: string | null;
	}

	let { expenseId, returnTo = '/expenses', preselectedVehicleId = null }: Props = $props();

	// Determine if we're in edit mode
	let isEditMode = $derived(!!expenseId);

	// Form data
	let formData = $state({
		vehicleId: '',
		tags: [] as string[],
		category: '',
		amount: '',
		date: new Date().toISOString().split('T')[0],
		mileage: '',
		volume: '',
		charge: '',
		fuelType: '',
		description: ''
	});

	// Form state
	let isLoading = $state(!!expenseId);
	let isSubmitting = $state(false);
	let isDeleting = $state(false);
	let showDeleteConfirm = $state(false);
	let vehicles = $state<Vehicle[]>([]);
	let errors = $state<ExpenseFormErrors>({});
	let touched = $state<Record<string, boolean>>({});
	let originalExpense = $state<Expense | null>(null);
	let vehicle = $state<Vehicle | null>(null);
	let lastFuelExpense = $state<Expense | null>(null);
	let allVehicleExpenses = $state<Expense[]>([]);
	let showMpgCalculation = $state(false);
	let calculatedMpg = $state<number | null>(null);
	let calculatedEfficiency = $state<number | null>(null);

	// Get user settings for units
	let settings = $derived($settingsStore.settings);
	let volumeUnit = $derived(settings?.volumeUnit || 'gallons_us');
	let chargeUnit = $derived(settings?.chargeUnit || 'kwh');
	let distanceUnit = $derived(settings?.distanceUnit || 'miles');
	let currencyUnit = $derived(settings?.currencyUnit || 'USD');

	// Tag suggestions will be populated from user's previous tags in the future

	onMount(async () => {
		await settingsStore.load();
		await loadVehicles();

		if (isEditMode && expenseId) {
			await loadExpense();
		} else if (preselectedVehicleId) {
			formData.vehicleId = preselectedVehicleId;
		}

		if (formData.vehicleId) {
			await loadVehicle();
			await loadLastFuelExpense();
			await loadAllVehicleExpenses();
		}
	});

	async function loadVehicles() {
		try {
			vehicles = await vehicleApi.getVehicles();
			if (!isEditMode && vehicles.length > 0 && !formData.vehicleId) {
				const firstVehicle = vehicles[0];
				if (firstVehicle) formData.vehicleId = firstVehicle.id;
			}
		} catch (error) {
			console.error('Failed to load vehicles:', error);
		}
	}

	async function loadExpense() {
		try {
			const expense = await expenseApi.getExpense(expenseId!);
			if (!expense) {
				appStore.addNotification({ type: 'error', message: 'Expense not found' });
				goto(returnTo);
				return;
			}

			originalExpense = expense;

			formData.vehicleId = expense.vehicleId;
			formData.tags = expense.tags || [];
			formData.category = expense.category;
			formData.amount = expense.amount.toString();
			const expenseDate = new Date(expense.date);
			formData.date = `${expenseDate.getFullYear()}-${String(expenseDate.getMonth() + 1).padStart(2, '0')}-${String(expenseDate.getDate()).padStart(2, '0')}`;
			formData.mileage = expense.mileage?.toString() ?? '';
			formData.volume = expense.volume?.toString() ?? '';
			formData.charge = expense.charge?.toString() ?? '';
			formData.fuelType = expense.fuelType || '';
			formData.description = expense.description || '';
			selectedCategoryLabel = expense.category === 'fuel' ? 'Fuel' : expense.category || '';
		} catch (error) {
			console.error('Error loading expense:', error);
			appStore.addNotification({ type: 'error', message: 'Error loading expense' });
			goto(returnTo);
		} finally {
			isLoading = false;
		}
	}

	async function loadVehicle() {
		try {
			vehicle = await vehicleApi.getVehicle(formData.vehicleId);
		} catch (error) {
			console.error('Error loading vehicle:', error);
		}
	}

	async function loadLastFuelExpense() {
		try {
			const expenses = await expenseApi.getExpensesByVehicle(formData.vehicleId);
			const fuelExpenses = expenses
				.filter(e => e.category === 'fuel' && e.id !== expenseId)
				.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
			lastFuelExpense = fuelExpenses[0] || null;
		} catch (error) {
			console.error('Error loading last fuel expense:', error);
		}
	}

	async function loadAllVehicleExpenses() {
		try {
			allVehicleExpenses = await expenseApi.getExpensesByVehicle(formData.vehicleId);
		} catch (error) {
			console.error('Error loading vehicle expenses:', error);
		}
	}

	function selectCategory(categoryValue: string, categoryLabel: string) {
		formData.category = categoryValue;
		touched['category'] = true;
		handleBlur('category');
		selectedCategoryLabel = categoryLabel;
	}

	let selectedCategoryLabel = $state('');

	// Watch vehicle changes
	$effect(() => {
		if (formData.vehicleId) {
			loadVehicle();
			loadLastFuelExpense();
			loadAllVehicleExpenses();
		}
	});

	// Show fuel-specific fields when Fuel category is selected
	let showFuelFields = $derived(selectedCategoryLabel === 'Fuel');

	// Determine which fuel type fields to show based on vehicle type
	let showVolumeField = $derived(showFuelFields && vehicle && usesLiquidFuel(vehicle.vehicleType));
	let showChargeField = $derived(
		showFuelFields && vehicle && usesElectricCharge(vehicle.vehicleType)
	);

	function handleMileageChange() {
		if (selectedCategoryLabel === 'Fuel' && formData.mileage && lastFuelExpense?.mileage) {
			const milesDriven = parseInt(formData.mileage) - lastFuelExpense.mileage;

			if (milesDriven > 0) {
				// Calculate fuel efficiency for liquid fuel vehicles
				if (formData.volume && vehicle && usesLiquidFuel(vehicle.vehicleType)) {
					calculatedMpg = Math.round((milesDriven / parseFloat(formData.volume)) * 100) / 100;
					showMpgCalculation = true;
				}
				// Calculate electric efficiency for electric vehicles
				else if (formData.charge && vehicle && usesElectricCharge(vehicle.vehicleType)) {
					calculatedEfficiency =
						Math.round((milesDriven / parseFloat(formData.charge)) * 100) / 100;
					showMpgCalculation = true;
				} else {
					calculatedMpg = null;
					calculatedEfficiency = null;
					showMpgCalculation = false;
				}
			} else {
				calculatedMpg = null;
				calculatedEfficiency = null;
				showMpgCalculation = false;
			}
		}
	}

	function handleBlur(field: string) {
		touched[field] = true;
		const error = validateExpenseField(field, {
			selectedCategoryLabel,
			vehicle,
			volumeUnit,
			chargeUnit,
			allVehicleExpenses,
			expenseId,
			formData: formData as unknown as Record<string, string | string[]>
		});
		if (error) {
			errors[field] = error;
		} else {
			delete errors[field];
			errors = { ...errors };
		}

		if (field === 'date' && formData.mileage) {
			handleBlur('mileage');
		}
	}

	function validateForm(): boolean {
		errors = {};
		const fields = ['vehicleId', 'category', 'amount', 'date'];
		if (showFuelFields) {
			fields.push('mileage');
			if (showVolumeField) fields.push('volume');
			if (showChargeField) fields.push('charge');
		}

		const ctx = {
			selectedCategoryLabel,
			vehicle,
			volumeUnit,
			chargeUnit,
			allVehicleExpenses,
			expenseId,
			formData: formData as unknown as Record<string, string | string[]>
		};

		for (const field of fields) {
			const error = validateExpenseField(field, ctx);
			if (error) errors[field] = error;
		}

		return Object.keys(errors).length === 0;
	}

	async function handleSubmit() {
		if (!validateForm()) {
			Object.keys(formData).forEach(field => {
				touched[field] = true;
			});
			return;
		}

		isSubmitting = true;

		try {
			// Convert date string to ISO format at noon local time to avoid timezone issues
			let dateISO: string;
			if (formData.date) {
				const parts = formData.date.split('-').map(Number);
				const year = parts[0] ?? 0;
				const month = parts[1] ?? 1;
				const day = parts[2] ?? 1;
				const localDate = new Date(year, month - 1, day, 12, 0, 0);
				dateISO = localDate.toISOString();
			} else {
				dateISO = new Date().toISOString();
			}

			const expenseData = {
				vehicleId: formData.vehicleId,
				tags: formData.tags,
				category: formData.category,
				amount: parseFloat(formData.amount),
				date: dateISO,
				mileage: formData.mileage ? parseInt(formData.mileage) : undefined,
				volume: formData.volume ? parseFloat(formData.volume) : undefined,
				charge: formData.charge ? parseFloat(formData.charge) : undefined,
				fuelType: formData.fuelType || undefined,
				description: formData.description || undefined,
				currency: currencyUnit
			};

			if (isEditMode) {
				// Update existing expense using API service
				await expenseApi.updateExpense(expenseId!, expenseData);

				appStore.addNotification({
					type: 'success',
					message: 'Expense updated successfully'
				});
				goto(returnTo);
			} else {
				// Create new expense
				if ($isOnline) {
					await expenseApi.createExpense(expenseData);

					appStore.addNotification({
						type: 'success',
						message: 'Expense added successfully'
					});
					goto(returnTo);
				} else {
					// Save offline
					addOfflineExpense({
						vehicleId: expenseData.vehicleId,
						tags: expenseData.tags,
						category: expenseData.category,
						amount: expenseData.amount,
						date: expenseData.date ?? '',
						description: expenseData.description ?? '',
						...(expenseData.mileage !== undefined && { mileage: expenseData.mileage }),
						...(expenseData.volume !== undefined && { volume: expenseData.volume }),
						...(expenseData.charge !== undefined && { charge: expenseData.charge })
					});

					requestBackgroundSync('expense-sync');

					appStore.addNotification({
						type: 'info',
						message: 'Expense saved offline. Will sync when online.'
					});

					goto(returnTo);
				}
			}
		} catch (error) {
			console.error('Failed to save expense:', error);

			if (!isEditMode) {
				// Save offline as fallback for new expenses
				const expenseData = {
					vehicleId: formData.vehicleId,
					tags: formData.tags,
					category: formData.category,
					amount: parseFloat(formData.amount),
					date: formData.date,
					mileage: formData.mileage ? parseInt(formData.mileage) : undefined,
					volume: formData.volume ? parseFloat(formData.volume) : undefined,
					charge: formData.charge ? parseFloat(formData.charge) : undefined,
					fuelType: formData.fuelType || undefined,
					description: formData.description || undefined
				};

				addOfflineExpense({
					vehicleId: expenseData.vehicleId,
					tags: expenseData.tags,
					category: expenseData.category,
					amount: expenseData.amount,
					date: expenseData.date ?? '',
					description: expenseData.description ?? '',
					...(expenseData.mileage !== undefined && { mileage: expenseData.mileage }),
					...(expenseData.volume !== undefined && { volume: expenseData.volume }),
					...(expenseData.charge !== undefined && { charge: expenseData.charge })
				});
				requestBackgroundSync('expense-sync');

				appStore.addNotification({
					type: 'warning',
					message: 'Saved offline due to connection issue. Will sync when online.'
				});

				goto(returnTo);
			} else {
				appStore.addNotification({
					type: 'error',
					message: 'Network error. Please try again.'
				});
			}
		} finally {
			isSubmitting = false;
		}
	}

	function confirmDelete() {
		showDeleteConfirm = true;
	}

	async function handleDelete() {
		if (!expenseId) return;

		isDeleting = true;

		try {
			await expenseApi.deleteExpense(expenseId);

			appStore.addNotification({
				type: 'success',
				message: 'Expense deleted successfully'
			});
			goto(returnTo);
		} catch (error) {
			console.error('Failed to delete expense:', error);
			appStore.addNotification({
				type: 'error',
				message: 'Failed to delete expense. Please try again.'
			});
		} finally {
			isDeleting = false;
			showDeleteConfirm = false;
		}
	}

	function handleBack() {
		goto(returnTo);
	}

	function getVehicleDisplayName(): string {
		if (!vehicle) return '';
		return vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
	}
</script>

{#if isLoading}
	<div class="flex items-center justify-center py-12">
		<LoaderCircle class="h-8 w-8 animate-spin text-primary" />
	</div>
{:else}
	<div class="max-w-2xl mx-auto space-y-6">
		<!-- Header -->
		<div class="flex items-center gap-4">
			<button onclick={() => goto(returnTo)} class="p-2 hover:bg-muted rounded-lg">
				<ArrowLeft class="h-5 w-5" />
			</button>

			<div>
				<h1 class="text-2xl font-bold text-foreground">
					{isEditMode ? 'Edit Expense' : 'Add Expense'}
				</h1>
				<p class="text-muted-foreground">
					{#if isEditMode}
						{getVehicleDisplayName()}
					{:else if !$isOnline}
						<span class="text-chart-5">Offline mode - will sync when online</span>
					{:else}
						Track a new vehicle expense
					{/if}
				</p>
			</div>
		</div>

		<!-- Form -->
		<form
			onsubmit={e => {
				e.preventDefault();
				handleSubmit();
			}}
			class="rounded-lg border bg-card p-6 space-y-6"
		>
			<!-- Vehicle Selection -->
			<div class="space-y-2">
				<Label for="vehicle">Vehicle *</Label>
				<Select.Root
					type="single"
					value={formData.vehicleId}
					onValueChange={v => {
						if (v) {
							formData.vehicleId = v;
							touched['vehicleId'] = true;
							handleBlur('vehicleId');
						}
					}}
				>
					<Select.Trigger
						id="vehicle"
						class="w-full {touched['vehicleId'] && errors['vehicleId'] ? 'border-destructive' : ''}"
						aria-invalid={!!(touched['vehicleId'] && errors['vehicleId'])}
						aria-describedby={touched['vehicleId'] && errors['vehicleId']
							? 'vehicleId-error'
							: undefined}
					>
						{#if formData.vehicleId}
							{@const selectedVehicle = vehicles.find(v => v.id === formData.vehicleId)}
							{#if selectedVehicle}
								{selectedVehicle.year}
								{selectedVehicle.make}
								{selectedVehicle.model}
								{#if selectedVehicle.nickname}({selectedVehicle.nickname}){/if}
							{:else}
								Select a vehicle
							{/if}
						{:else}
							Select a vehicle
						{/if}
					</Select.Trigger>
					<Select.Content>
						{#each vehicles as v (v.id)}
							<Select.Item value={v.id} label="{v.year} {v.make} {v.model}">
								{v.year}
								{v.make}
								{v.model}
								{#if v.nickname}({v.nickname}){/if}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				{#if touched['vehicleId'] && errors['vehicleId']}
					<FormFieldError id="vehicleId-error">{errors['vehicleId']}</FormFieldError>
				{/if}
			</div>

			<!-- Category Selection (Required) -->
			<CategorySelector
				value={formData.category}
				error={errors['category']}
				touched={touched['category']}
				onSelect={value => selectCategory(value, value)}
			/>

			<!-- Amount -->
			<div class="space-y-2">
				<Label for="amount">Amount *</Label>
				<div class="relative">
					<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
						<span class="text-muted-foreground">$</span>
					</div>
					<Input
						id="amount"
						type="number"
						step="0.01"
						min="0"
						bind:value={formData.amount}
						placeholder="0.00"
						class="pl-8"
						onblur={() => handleBlur('amount')}
						aria-invalid={!!(touched['amount'] && errors['amount'])}
						aria-describedby={touched['amount'] && errors['amount'] ? 'amount-error' : undefined}
					/>
				</div>
				{#if touched['amount'] && errors['amount']}
					<FormFieldError id="amount-error">{errors['amount']}</FormFieldError>
				{/if}
			</div>

			<!-- Date -->
			<div class="space-y-2">
				<Label for="date">Date *</Label>
				<DatePicker
					id="date"
					bind:value={formData.date}
					placeholder="Select date"
					aria-invalid={!!(touched['date'] && errors['date'])}
					aria-describedby={touched['date'] && errors['date'] ? 'date-error' : undefined}
				/>
				{#if touched['date'] && errors['date']}
					<FormFieldError id="date-error">{errors['date']}</FormFieldError>
				{/if}
			</div>

			<!-- Mileage (always visible, required for fuel) -->
			<div class="space-y-2">
				<Label for="mileage">
					Current Mileage {showFuelFields ? '*' : '(Optional)'}
				</Label>
				<div class="relative">
					<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
						<Gauge class="h-5 w-5 text-muted-foreground" />
					</div>
					<Input
						id="mileage"
						type="number"
						min="0"
						bind:value={formData.mileage}
						placeholder="123456"
						class="pl-10"
						oninput={handleMileageChange}
						onblur={() => handleBlur('mileage')}
						aria-invalid={!!(touched['mileage'] && errors['mileage'])}
						aria-describedby={touched['mileage'] && errors['mileage'] ? 'mileage-error' : undefined}
					/>
				</div>
				{#if lastFuelExpense?.mileage && formData.tags.includes('fuel')}
					<p class="text-xs text-muted-foreground">
						Previous fuel entry: {lastFuelExpense.mileage.toLocaleString()} miles
					</p>
				{/if}
				{#if touched['mileage'] && errors['mileage']}
					<FormFieldError id="mileage-error">{errors['mileage']}</FormFieldError>
				{/if}
			</div>

			<!-- Fuel-specific fields -->
			{#if showFuelFields && vehicle}
				<FuelFieldsSection
					vehicleType={vehicle.vehicleType}
					bind:volume={formData.volume}
					bind:charge={formData.charge}
					bind:fuelType={formData.fuelType}
					amount={formData.amount}
					{volumeUnit}
					{chargeUnit}
					{distanceUnit}
					{calculatedMpg}
					{calculatedEfficiency}
					{showMpgCalculation}
					{errors}
					{touched}
					onBlur={handleBlur}
					onMileageChange={handleMileageChange}
				/>
			{/if}

			<!-- Description -->
			<div class="space-y-2">
				<Label for="description">Description (Optional)</Label>
				<Textarea
					id="description"
					bind:value={formData.description}
					rows={3}
					placeholder="Add any additional notes..."
					class="bg-background"
				/>
			</div>

			<!-- Tags -->
			<TagInput bind:tags={formData.tags} error={errors['tags']} touched={touched['tags']} />
		</form>

		<!-- Floating Action Bar -->
		<div
			class="fixed sm:bottom-8 sm:right-8 bottom-4 left-4 right-4 sm:left-auto sm:w-auto w-auto z-50"
		>
			<div
				class="flex flex-row gap-3 sm:gap-4 justify-center sm:justify-end items-center bg-background sm:bg-transparent p-3 sm:p-0 rounded-full sm:rounded-none shadow-2xl sm:shadow-none"
			>
				{#if isEditMode}
					<Button
						type="button"
						variant="destructive"
						onclick={confirmDelete}
						disabled={isDeleting || isSubmitting}
						class="sm:rounded-full rounded-full shadow-lg transition-all duration-300 sm:hover:scale-105 h-14 sm:h-14 px-5 border-0 flex-shrink-0"
					>
						<Trash2 class="h-5 w-5 sm:mr-2" />
						<span class="hidden sm:inline font-semibold">Delete</span>
					</Button>
				{/if}

				<Button
					type="button"
					variant="outline"
					onclick={handleBack}
					disabled={isSubmitting || isDeleting}
					class="sm:rounded-full rounded-full bg-muted-foreground hover:bg-muted-foreground/80 text-background shadow-lg transition-all duration-300 sm:hover:scale-105 h-14 sm:h-14 px-5 border-0 flex-shrink-0"
				>
					<X class="h-5 w-5 sm:mr-2" />
					<span class="hidden sm:inline font-semibold">Cancel</span>
				</Button>

				<Button
					type="button"
					onclick={handleSubmit}
					disabled={isSubmitting || isDeleting}
					class="sm:rounded-full rounded-full group bg-foreground hover:bg-foreground/90 text-background shadow-2xl transition-all duration-300 sm:hover:scale-110 h-14 sm:h-14 px-6 border-0 flex-1 sm:flex-initial"
				>
					{#if isSubmitting}
						<LoaderCircle class="h-5 w-5 animate-spin mr-2" />
						<span class="font-bold">{isEditMode ? 'Updating' : 'Saving'}...</span>
					{:else}
						<Check class="h-5 w-5 mr-2 transition-transform duration-300 group-hover:scale-110" />
						<span class="font-bold">{isEditMode ? 'Update' : 'Save'} Expense</span>
					{/if}
				</Button>
			</div>
		</div>
	</div>

	<!-- Delete Confirmation AlertDialog -->
	<AlertDialog.Root bind:open={showDeleteConfirm}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Delete Expense</AlertDialog.Title>
				<AlertDialog.Description>
					Are you sure you want to delete this expense? This action cannot be undone.
				</AlertDialog.Description>
			</AlertDialog.Header>

			{#if originalExpense}
				<div class="bg-muted rounded-lg p-3">
					<div class="flex items-center gap-3">
						<div class="p-2 rounded-lg bg-destructive/10 text-destructive">
							<Save class="h-4 w-4" />
						</div>
						<div>
							<p class="font-medium text-foreground">
								{originalExpense.description || originalExpense.tags?.join(', ') || 'Expense'}
							</p>
							<p class="text-sm text-muted-foreground">
								${originalExpense.amount.toFixed(2)} on {new Date(
									originalExpense.date
								).toLocaleDateString()}
							</p>
						</div>
					</div>
				</div>
			{/if}

			<AlertDialog.Footer>
				<AlertDialog.Cancel disabled={isDeleting}>Cancel</AlertDialog.Cancel>
				<AlertDialog.Action
					onclick={handleDelete}
					disabled={isDeleting}
					class="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
				>
					{#if isDeleting}
						<LoaderCircle class="h-4 w-4 animate-spin mr-2" />
						Deleting...
					{:else}
						Delete Expense
					{/if}
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
{/if}
