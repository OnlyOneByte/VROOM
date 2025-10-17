<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { isOnline } from '$lib/stores/offline';
	import { addOfflineExpense } from '$lib/utils/offline-storage';
	import { requestBackgroundSync } from '$lib/utils/pwa';
	import { appStore } from '$lib/stores/app';
	import { settingsStore } from '$lib/stores/settings';
	import {
		Save,
		ArrowLeft,
		Fuel,
		Gauge,
		Check,
		X,
		Trash2,
		Wrench,
		CreditCard,
		FileText,
		Sparkles,
		Coffee,
		Zap
	} from 'lucide-svelte';
	import DatePicker from '$lib/components/ui/date-picker.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Select from '$lib/components/ui/select';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button } from '$lib/components/ui/button';
	import { FormFieldError } from '$lib/components/ui/form-field';
	import type { ExpenseFormErrors, Vehicle, Expense } from '$lib/types.js';
	import {
		getVolumeUnitLabel,
		getChargeUnitLabel,
		usesLiquidFuel,
		usesElectricCharge,
		getFuelEfficiencyLabel,
		getElectricEfficiencyLabel
	} from '$lib/utils/units';

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
		description: ''
	});

	// Tag input state
	let tagInput = $state('');
	let showTagSuggestions = $state(false);

	// Form state
	let isLoading = $state(!!expenseId);
	let isSubmitting = $state(false);
	let isDeleting = $state(false);
	let showDeleteConfirm = $state(false);
	let vehicles = $state<any[]>([]);
	let errors = $state<ExpenseFormErrors>({});
	let touched = $state<Record<string, boolean>>({});
	let originalExpense = $state<Expense | null>(null);
	let vehicle = $state<Vehicle | null>(null);
	let lastFuelExpense = $state<any>(null);
	let allVehicleExpenses = $state<any[]>([]);
	let showMpgCalculation = $state(false);
	let calculatedMpg = $state<number | null>(null);
	let calculatedEfficiency = $state<number | null>(null);

	// Get user settings for units
	let settings = $derived($settingsStore.settings);
	let volumeUnit = $derived(settings?.volumeUnit || 'gallons_us');
	let chargeUnit = $derived(settings?.chargeUnit || 'kwh');
	let distanceUnit = $derived(settings?.distanceUnit || 'miles');

	// Tag suggestions will be populated from user's previous tags in the future
	// const commonTags: string[] = [];

	const categories = [
		{
			value: 'fuel',
			label: 'Fuel',
			description: 'Gas and fuel costs',
			icon: Fuel
		},
		{
			value: 'maintenance',
			label: 'Maintenance',
			description: 'Keeping the car running',
			icon: Wrench
		},
		{
			value: 'financial',
			label: 'Financial',
			description: 'Insurance, loan payment, lease payment, etc',
			icon: CreditCard
		},
		{
			value: 'regulatory',
			label: 'Regulatory',
			description: 'Registration, tickets, inspections, etc',
			icon: FileText
		},
		{
			value: 'enhancement',
			label: 'Enhancement',
			description: 'Optional improvements',
			icon: Sparkles
		},
		{
			value: 'misc',
			label: 'Misc Operating Costs',
			description: 'Tolls, parking, etc.',
			icon: Coffee
		}
	];

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
			const response = await fetch('/api/vehicles');
			if (response.ok) {
				const result = await response.json();
				vehicles = result.data || [];
				if (!isEditMode && vehicles.length > 0 && !formData.vehicleId) {
					formData.vehicleId = vehicles[0].id;
				}
			}
		} catch (error) {
			console.error('Failed to load vehicles:', error);
		}
	}

	async function loadExpense() {
		try {
			const response = await fetch(`/api/expenses/${expenseId}`, {
				credentials: 'include'
			});

			if (response.ok) {
				const result = await response.json();
				originalExpense = result.data;

				if (originalExpense) {
					formData.vehicleId = originalExpense.vehicleId;
					formData.tags = originalExpense.tags || [];
					formData.category = originalExpense.category;
					formData.amount = originalExpense.amount.toString();
					// Convert timestamp to local date string (YYYY-MM-DD)
					const expenseDate = new Date(originalExpense.date);
					const year = expenseDate.getFullYear();
					const month = String(expenseDate.getMonth() + 1).padStart(2, '0');
					const day = String(expenseDate.getDate()).padStart(2, '0');
					formData.date = `${year}-${month}-${day}`;
					formData.mileage = originalExpense.mileage?.toString() ?? '';
					formData.volume = originalExpense.volume?.toString() ?? '';
					formData.charge = originalExpense.charge?.toString() ?? '';
					formData.description = originalExpense.description || '';

					// Set the category label for fuel field detection
					const selectedCategory = categories.find(c => c.value === originalExpense?.category);
					if (selectedCategory) {
						selectedCategoryLabel = selectedCategory.label;
					}
				}
			} else {
				appStore.addNotification({
					type: 'error',
					message: 'Expense not found'
				});
				goto(returnTo);
			}
		} catch (error) {
			console.error('Error loading expense:', error);
			appStore.addNotification({
				type: 'error',
				message: 'Error loading expense'
			});
			goto(returnTo);
		} finally {
			isLoading = false;
		}
	}

	async function loadVehicle() {
		try {
			const response = await fetch(`/api/vehicles/${formData.vehicleId}`, {
				credentials: 'include'
			});

			if (response.ok) {
				const result = await response.json();
				vehicle = result.data;
			}
		} catch (error) {
			console.error('Error loading vehicle:', error);
		}
	}

	async function loadLastFuelExpense() {
		try {
			const response = await fetch(
				`/api/expenses?vehicleId=${formData.vehicleId}&type=fuel&limit=2`,
				{
					credentials: 'include'
				}
			);

			if (response.ok) {
				const result = await response.json();
				if (result.data && result.data.length > 0) {
					lastFuelExpense = result.data.find((expense: any) => expense.id !== expenseId) || null;
				}
			}
		} catch (error) {
			console.error('Error loading last fuel expense:', error);
		}
	}

	async function loadAllVehicleExpenses() {
		try {
			const response = await fetch(`/api/expenses?vehicleId=${formData.vehicleId}`, {
				credentials: 'include'
			});

			if (response.ok) {
				const result = await response.json();
				allVehicleExpenses = result.data || [];
			}
		} catch (error) {
			console.error('Error loading vehicle expenses:', error);
		}
	}

	function selectCategory(categoryValue: string, categoryLabel: string) {
		formData.category = categoryValue;
		touched['category'] = true;
		validateField('category');

		// Store the selected category label for fuel field detection
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

	// Filtered tag suggestions (will be populated from user's previous tags in the future)
	let filteredSuggestions = $derived<string[]>([]);

	function addTag(tag: string): void {
		if (tag && !formData.tags.includes(tag) && formData.tags.length < 10) {
			formData.tags = [...formData.tags, tag.toLowerCase().trim()];
			tagInput = '';
			showTagSuggestions = false;
			touched['tags'] = true;
		}
	}

	function removeTag(tag: string): void {
		formData.tags = formData.tags.filter((t: string) => t !== tag);
	}

	function handleTagInputKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (tagInput.trim()) {
				addTag(tagInput.trim());
			}
		} else if (e.key === 'Backspace' && !tagInput && formData.tags.length > 0) {
			const lastTag = formData.tags[formData.tags.length - 1];
			if (lastTag) {
				removeTag(lastTag);
			}
		}
	}

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
		validateField(field);

		// If date changes, revalidate mileage since it's date-dependent
		if (field === 'date' && formData.mileage) {
			validateField('mileage');
		}
	}

	function validateField(field: string): string | null {
		if (field === 'tags') {
			// Tags are now optional
			return null;
		}

		const value = formData[field as keyof typeof formData];

		switch (field) {
			case 'vehicleId':
				if (!value) return 'Please select a vehicle';
				break;

			case 'category':
				if (!value) return 'Please select a category';
				break;

			case 'amount': {
				const amount = parseFloat(value as string);
				if (!value || amount <= 0) return 'Amount must be greater than 0';
				if (amount > 999999) return 'Amount seems too large';
				break;
			}
			case 'date': {
				if (!value) return 'Date is required';
				const selectedDate = new Date(value as string);
				const today = new Date();
				if (selectedDate > today) return 'Date cannot be in the future';
				break;
			}
			case 'volume': {
				if (selectedCategoryLabel === 'Fuel' && vehicle && usesLiquidFuel(vehicle.vehicleType)) {
					const volume = parseFloat(value as string);
					const unitLabel = getVolumeUnitLabel(volumeUnit);
					if (!value || volume <= 0) return `${unitLabel} required for fuel expenses`;
					if (volume > 1000) return `${unitLabel} seems too large`;
				}
				break;
			}
			case 'charge': {
				if (
					selectedCategoryLabel === 'Fuel' &&
					vehicle &&
					usesElectricCharge(vehicle.vehicleType)
				) {
					const charge = parseFloat(value as string);
					const unitLabel = getChargeUnitLabel(chargeUnit);
					if (!value || charge <= 0) return `${unitLabel} required for charging expenses`;
					if (charge > 1000) return `${unitLabel} seems too large`;
				}
				break;
			}
			case 'mileage': {
				if (selectedCategoryLabel === 'Fuel') {
					const mileage = parseInt(value as string);
					if (!value || mileage <= 0) return 'Mileage required for fuel expenses';

					// Check against vehicle's initial mileage
					if (vehicle?.initialMileage && mileage < vehicle.initialMileage) {
						return 'Mileage cannot be less than initial mileage';
					}

					// Date-based validation - use the date string directly (YYYY-MM-DD format)
					const currentDateStr: string =
						formData.date || new Date().toISOString().split('T')[0] || '';

					// Filter out the current expense if editing
					const otherExpenses = allVehicleExpenses.filter(
						exp => exp.id !== expenseId && exp.mileage != null
					);

					// Check entries before this date (excluding same day)
					const entriesBefore = otherExpenses.filter(exp => {
						const expDate = new Date(exp.date);
						const expDateStr = `${expDate.getFullYear()}-${String(expDate.getMonth() + 1).padStart(2, '0')}-${String(expDate.getDate()).padStart(2, '0')}`;
						return expDateStr < currentDateStr;
					});

					if (entriesBefore.length > 0) {
						const maxMileageBefore = Math.max(...entriesBefore.map(exp => exp.mileage));
						if (mileage <= maxMileageBefore) {
							return `Mileage must be greater than ${maxMileageBefore.toLocaleString()} (from earlier entry)`;
						}
					}

					// Check entries after this date (excluding same day)
					const entriesAfter = otherExpenses.filter(exp => {
						const expDate = new Date(exp.date);
						const expDateStr = `${expDate.getFullYear()}-${String(expDate.getMonth() + 1).padStart(2, '0')}-${String(expDate.getDate()).padStart(2, '0')}`;
						return expDateStr > currentDateStr;
					});

					if (entriesAfter.length > 0) {
						const minMileageAfter = Math.min(...entriesAfter.map(exp => exp.mileage));
						if (mileage >= minMileageAfter) {
							return `Mileage must be less than ${minMileageAfter.toLocaleString()} (from later entry)`;
						}
					}
				}
				break;
			}
		}
		return null;
	}

	function validateForm(): boolean {
		errors = {};

		const fields = ['vehicleId', 'category', 'amount', 'date'];
		if (showFuelFields) {
			fields.push('mileage');
			if (showVolumeField) {
				fields.push('volume');
			}
			if (showChargeField) {
				fields.push('charge');
			}
		}

		fields.forEach(field => {
			const error = validateField(field);
			if (error) {
				errors[field] = error;
			}
		});

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
				description: formData.description || undefined,
				currency: 'USD'
			};

			if (isEditMode) {
				// Update existing expense
				const response = await fetch(`/api/expenses/${expenseId}`, {
					method: 'PUT',
					headers: {
						'Content-Type': 'application/json'
					},
					credentials: 'include',
					body: JSON.stringify(expenseData)
				});

				if (response.ok) {
					appStore.addNotification({
						type: 'success',
						message: 'Expense updated successfully'
					});
					goto(returnTo);
				} else {
					const result = await response.json();
					throw new Error(result.message || 'Failed to update expense');
				}
			} else {
				// Create new expense
				if ($isOnline) {
					const response = await fetch(`/api/expenses`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json'
						},
						credentials: 'include',
						body: JSON.stringify(expenseData)
					});

					if (response.ok) {
						appStore.addNotification({
							type: 'success',
							message: 'Expense added successfully'
						});
						goto(returnTo);
					} else {
						throw new Error('Failed to save expense');
					}
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
			const response = await fetch(`/api/expenses/${expenseId}`, {
				method: 'DELETE',
				credentials: 'include'
			});

			if (response.ok) {
				appStore.addNotification({
					type: 'success',
					message: 'Expense deleted successfully'
				});
				goto(returnTo);
			} else {
				const result = await response.json();
				throw new Error(result.message || 'Failed to delete expense');
			}
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
		<div class="loading-spinner h-8 w-8"></div>
	</div>
{:else}
	<div class="max-w-2xl mx-auto space-y-6">
		<!-- Header -->
		<div class="flex items-center gap-4">
			<button onclick={() => goto(returnTo)} class="p-2 hover:bg-gray-100 rounded-lg">
				<ArrowLeft class="h-5 w-5" />
			</button>

			<div>
				<h1 class="text-2xl font-bold text-gray-900">
					{isEditMode ? 'Edit Expense' : 'Add Expense'}
				</h1>
				<p class="text-gray-600">
					{#if isEditMode}
						{getVehicleDisplayName()}
					{:else if !$isOnline}
						<span class="text-orange-600">Offline mode - will sync when online</span>
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
			class="card space-y-6"
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
						class="w-full {touched['vehicleId'] && errors['vehicleId'] ? 'border-red-300' : ''}"
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
						{#each vehicles as vehicle (vehicle.id)}
							<Select.Item value={vehicle.id} label="{vehicle.year} {vehicle.make} {vehicle.model}">
								{vehicle.year}
								{vehicle.make}
								{vehicle.model}
								{#if vehicle.nickname}({vehicle.nickname}){/if}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				{#if touched['vehicleId'] && errors['vehicleId']}
					<FormFieldError id="vehicleId-error">{errors['vehicleId']}</FormFieldError>
				{/if}
			</div>

			<!-- Category Selection (Required) -->
			<div class="space-y-3">
				<Label for="category">Category *</Label>
				<div
					class="grid grid-cols-2 sm:grid-cols-3 gap-3"
					role="group"
					aria-labelledby="category"
					aria-describedby={touched['category'] && errors['category']
						? 'category-error'
						: undefined}
				>
					{#each categories as category (category.value)}
						{@const Icon = category.icon}
						<button
							type="button"
							onclick={() => selectCategory(category.value, category.label)}
							class="p-4 rounded-lg border-2 transition-all text-left {formData.category ===
							category.value
								? 'border-primary-500 bg-primary-50 shadow-md'
								: 'border-gray-200 hover:border-gray-300 bg-white'} {touched['category'] &&
							errors['category']
								? 'border-red-300'
								: ''}"
							aria-pressed={formData.category === category.value}
						>
							<div class="flex flex-col gap-2">
								<div class="flex items-center gap-2">
									<Icon
										class="h-5 w-5 {formData.category === category.value
											? 'text-primary-600'
											: 'text-gray-500'}"
									/>
									<span
										class="font-medium text-sm {formData.category === category.value
											? 'text-primary-900'
											: 'text-gray-900'}"
									>
										{category.label}
									</span>
								</div>
								<p
									class="text-xs {formData.category === category.value
										? 'text-primary-700'
										: 'text-gray-600'}"
								>
									{category.description}
								</p>
							</div>
						</button>
					{/each}
				</div>
				{#if touched['category'] && errors['category']}
					<FormFieldError id="category-error">{errors['category']}</FormFieldError>
				{/if}
			</div>

			<!-- Amount -->
			<div class="space-y-2">
				<Label for="amount">Amount *</Label>
				<div class="relative">
					<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
						<span class="text-gray-500">$</span>
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
						<Gauge class="h-5 w-5 text-gray-400" />
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
					<p class="text-xs text-gray-600">
						Previous fuel entry: {lastFuelExpense.mileage.toLocaleString()} miles
					</p>
				{/if}
				{#if touched['mileage'] && errors['mileage']}
					<FormFieldError id="mileage-error">{errors['mileage']}</FormFieldError>
				{/if}
			</div>

			<!-- Fuel-specific fields -->
			{#if showFuelFields}
				<div class="p-4 bg-blue-50 rounded-lg space-y-4">
					<div class="flex items-center gap-2 text-blue-700">
						{#if vehicle?.vehicleType === 'electric'}
							<Zap class="h-5 w-5" />
							<h3 class="font-medium">Charging Details</h3>
						{:else}
							<Fuel class="h-5 w-5" />
							<h3 class="font-medium">Fuel Details</h3>
						{/if}
					</div>

					<!-- Volume field for gas/hybrid vehicles -->
					{#if showVolumeField}
						<div class="space-y-2">
							<Label for="volume">{getVolumeUnitLabel(volumeUnit)} *</Label>
							<Input
								id="volume"
								type="number"
								step="0.001"
								min="0"
								bind:value={formData.volume}
								placeholder="0.000"
								oninput={handleMileageChange}
								onblur={() => handleBlur('volume')}
								aria-invalid={!!(touched['volume'] && errors['volume'])}
								aria-describedby={touched['volume'] && errors['volume']
									? 'volume-error'
									: undefined}
							/>
							{#if touched['volume'] && errors['volume']}
								<FormFieldError id="volume-error">{errors['volume']}</FormFieldError>
							{/if}
						</div>

						{#if formData.volume && formData.amount}
							<div class="text-sm text-gray-600">
								<strong>Price per {getVolumeUnitLabel(volumeUnit, true)}:</strong> ${(
									parseFloat(formData.amount) / parseFloat(formData.volume)
								).toFixed(3)}
							</div>
						{/if}
					{/if}

					<!-- Charge field for electric/hybrid vehicles -->
					{#if showChargeField}
						<div class="space-y-2">
							<Label for="charge">{getChargeUnitLabel(chargeUnit)} *</Label>
							<Input
								id="charge"
								type="number"
								step="0.01"
								min="0"
								bind:value={formData.charge}
								placeholder="0.00"
								oninput={handleMileageChange}
								onblur={() => handleBlur('charge')}
								aria-invalid={!!(touched['charge'] && errors['charge'])}
								aria-describedby={touched['charge'] && errors['charge']
									? 'charge-error'
									: undefined}
							/>
							{#if touched['charge'] && errors['charge']}
								<FormFieldError id="charge-error">{errors['charge']}</FormFieldError>
							{/if}
						</div>

						{#if formData.charge && formData.amount}
							<div class="text-sm text-gray-600">
								<strong>Price per {getChargeUnitLabel(chargeUnit, true)}:</strong> ${(
									parseFloat(formData.amount) / parseFloat(formData.charge)
								).toFixed(3)}
							</div>
						{/if}
					{/if}

					<!-- Efficiency Calculation -->
					{#if showMpgCalculation}
						{#if calculatedMpg && showVolumeField}
							<div class="bg-green-50 border border-green-200 rounded-lg p-3">
								<div class="flex items-center gap-2 text-green-700">
									<Gauge class="h-4 w-4" />
									<span class="text-sm font-medium">
										Calculated: {calculatedMpg}
										{getFuelEfficiencyLabel(distanceUnit, volumeUnit)}
									</span>
								</div>
								{#if calculatedMpg < 15}
									<p class="text-xs text-orange-600 mt-1">
										⚠️ Low fuel efficiency - consider maintenance check
									</p>
								{:else if calculatedMpg > 50}
									<p class="text-xs text-green-600 mt-1">✅ Excellent fuel efficiency!</p>
								{/if}
							</div>
						{:else if calculatedEfficiency && showChargeField}
							<div class="bg-green-50 border border-green-200 rounded-lg p-3">
								<div class="flex items-center gap-2 text-green-700">
									<Zap class="h-4 w-4" />
									<span class="text-sm font-medium">
										Calculated: {calculatedEfficiency}
										{getElectricEfficiencyLabel(distanceUnit, chargeUnit)}
									</span>
								</div>
								{#if calculatedEfficiency < 2}
									<p class="text-xs text-orange-600 mt-1">
										⚠️ Low efficiency - check driving conditions
									</p>
								{:else if calculatedEfficiency > 4}
									<p class="text-xs text-green-600 mt-1">✅ Excellent efficiency!</p>
								{/if}
							</div>
						{/if}
					{/if}
				</div>
			{/if}

			<!-- Description -->
			<div class="space-y-2">
				<Label for="description">Description (Optional)</Label>
				<Textarea
					id="description"
					bind:value={formData.description}
					rows={3}
					placeholder="Add any additional notes..."
					class="bg-white"
				/>
			</div>

			<!-- Tags -->
			<div class="space-y-2">
				<Label for="tags">Tags (Optional)</Label>
				<div
					class="border rounded-lg p-2 min-h-[42px] bg-white {touched['tags'] && errors['tags']
						? 'border-red-300'
						: 'border-gray-300'}"
				>
					<div class="flex flex-wrap gap-2 items-center">
						{#each formData.tags as tag}
							<span
								class="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
							>
								{tag}
								<button
									type="button"
									onclick={() => removeTag(tag)}
									class="hover:text-blue-900"
									aria-label="Remove {tag} tag"
								>
									<svg class="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
										<path
											fill-rule="evenodd"
											d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
											clip-rule="evenodd"
										/>
									</svg>
								</button>
							</span>
						{/each}
						<input
							id="tags"
							type="text"
							bind:value={tagInput}
							onkeydown={handleTagInputKeydown}
							onfocus={() => (showTagSuggestions = true)}
							onblur={() => setTimeout(() => (showTagSuggestions = false), 200)}
							placeholder={formData.tags.length === 0 ? 'Add tags (e.g., fuel, maintenance)' : ''}
							class="flex-1 min-w-[120px] outline-none bg-transparent"
							aria-describedby={touched['tags'] && errors['tags'] ? 'tags-error' : undefined}
						/>
					</div>
				</div>

				<!-- Tag Suggestions -->
				{#if showTagSuggestions && filteredSuggestions.length > 0}
					<div
						class="border border-gray-200 rounded-lg shadow-lg bg-white max-h-48 overflow-y-auto"
					>
						{#each filteredSuggestions.slice(0, 8) as suggestion}
							<button
								type="button"
								onclick={() => addTag(suggestion)}
								class="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
							>
								{suggestion}
							</button>
						{/each}
					</div>
				{/if}

				<p class="text-xs text-gray-500">
					Press Enter to add a tag, or click suggestions below. Maximum 10 tags.
				</p>

				{#if touched['tags'] && errors['tags']}
					<FormFieldError id="tags-error">{errors['tags']}</FormFieldError>
				{/if}
			</div>
		</form>

		<!-- Floating Action Bar -->
		<div
			class="fixed sm:bottom-8 sm:right-8 bottom-4 left-4 right-4 sm:left-auto sm:w-auto w-auto !z-50"
		>
			<div
				class="flex flex-row gap-3 sm:gap-4 justify-center sm:justify-end items-center bg-white sm:bg-transparent p-3 sm:p-0 rounded-full sm:rounded-none shadow-2xl sm:shadow-none"
			>
				{#if isEditMode}
					<Button
						type="button"
						onclick={confirmDelete}
						disabled={isDeleting || isSubmitting}
						class="sm:rounded-full rounded-full !bg-red-600 hover:!bg-red-700 !text-white shadow-lg hover:shadow-red-500/50 transition-all duration-300 sm:hover:scale-105 h-14 sm:h-14 !px-5 !border-0 flex-shrink-0"
					>
						<Trash2 class="h-5 w-5 sm:mr-2" />
						<span class="hidden sm:inline font-semibold">Delete</span>
					</Button>
				{/if}

				<Button
					type="button"
					onclick={handleBack}
					disabled={isSubmitting || isDeleting}
					class="sm:rounded-full rounded-full !bg-gray-600 hover:!bg-gray-700 !text-white shadow-lg hover:shadow-gray-500/50 transition-all duration-300 sm:hover:scale-105 h-14 sm:h-14 !px-5 !border-0 flex-shrink-0"
				>
					<X class="h-5 w-5 sm:mr-2" />
					<span class="hidden sm:inline font-semibold">Cancel</span>
				</Button>

				<Button
					type="submit"
					onclick={handleSubmit}
					disabled={isSubmitting || isDeleting}
					class="sm:rounded-full rounded-full group !bg-gradient-to-r !from-primary-600 !to-primary-700 hover:!from-primary-700 hover:!to-primary-800 !text-white shadow-2xl hover:shadow-primary-500/50 transition-all duration-300 sm:hover:scale-110 h-14 sm:h-14 !px-6 !border-0 flex-1 sm:flex-initial"
				>
					{#if isSubmitting}
						<div class="loading-spinner h-5 w-5 mr-2"></div>
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
				<div class="bg-gray-50 rounded-lg p-3">
					<div class="flex items-center gap-3">
						<div class="p-2 rounded-lg bg-red-100 text-red-600">
							<Save class="h-4 w-4" />
						</div>
						<div>
							<p class="font-medium text-gray-900">
								{originalExpense.description || originalExpense.tags?.join(', ') || 'Expense'}
							</p>
							<p class="text-sm text-gray-600">
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
					class="bg-red-600 hover:bg-red-700 text-white"
				>
					{#if isDeleting}
						<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
						Deleting...
					{:else}
						Delete Expense
					{/if}
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
{/if}

<style>
	.loading-spinner {
		border: 2px solid #f3f4f6;
		border-top: 2px solid #3b82f6;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}
</style>
