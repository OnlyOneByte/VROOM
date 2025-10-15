<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { appStore } from '$lib/stores/app.js';
	import {
		ArrowLeft,
		DollarSign,
		Calendar,
		Fuel,
		Wrench,
		CreditCard,
		FileText,
		AlertCircle,
		CheckCircle,
		Gauge
	} from 'lucide-svelte';
	import type {
		Vehicle,
		ExpenseType,
		ExpenseCategory,
		ExpenseFormData,
		ExpenseFormErrors
	} from '$lib/types.js';

	const vehicleId = $page.params.id;

	// Component state
	let isLoading = $state(true);
	let isSubmitting = $state(false);
	let vehicle = $state<Vehicle | null>(null);
	let showMpgCalculation = $state(false);
	let calculatedMpg = $state<number | null>(null);
	let lastFuelExpense = $state<any>(null);

	// Form data
	let formData = $state<ExpenseFormData>({
		vehicleId: vehicleId!,
		type: 'fuel',
		category: 'operating',
		amount: 0,
		date: new Date().toISOString().split('T')[0] ?? '',

		gallons: undefined,
		description: ''
	});

	// Form validation
	let errors = $state<ExpenseFormErrors>({});
	let touched = $state<Record<string, boolean>>({});

	// Expense categories and types mapping
	const categoryMapping = {
		operating: ['fuel', 'tolls', 'parking'],
		maintenance: ['maintenance', 'repairs', 'tires', 'oil-change'],
		financial: ['insurance', 'loan-payment'],
		regulatory: ['registration', 'inspection', 'emissions', 'tickets'],
		enhancement: ['modifications', 'accessories', 'detailing'],
		convenience: ['other']
	};

	const typeLabels: Record<ExpenseType, string> = {
		fuel: 'Fuel',
		tolls: 'Tolls',
		parking: 'Parking',
		maintenance: 'Maintenance',
		repairs: 'Repairs',
		tires: 'Tires',
		'oil-change': 'Oil Change',
		insurance: 'Insurance',
		'loan-payment': 'Loan Payment',
		registration: 'Registration',
		inspection: 'Inspection',
		emissions: 'Emissions',
		tickets: 'Tickets',
		modifications: 'Modifications',
		accessories: 'Accessories',
		detailing: 'Detailing',
		other: 'Other'
	};

	const categoryLabels: Record<ExpenseCategory, string> = {
		operating: 'Operating',
		maintenance: 'Maintenance',
		financial: 'Financial',
		regulatory: 'Regulatory',
		enhancement: 'Enhancement',
		convenience: 'Convenience'
	};

	onMount(async () => {
		await loadVehicle();
		await loadLastFuelExpense();
	});

	async function loadVehicle() {
		try {
			const response = await fetch(`/api/vehicles/${vehicleId}`, {
				credentials: 'include'
			});

			if (response.ok) {
				vehicle = await response.json();
			} else {
				appStore.addNotification({
					type: 'error',
					message: 'Vehicle not found'
				});
				goto('/vehicles');
			}
		} catch {
			appStore.addNotification({
				type: 'error',
				message: 'Error loading vehicle'
			});
			goto('/vehicles');
		} finally {
			isLoading = false;
		}
	}

	async function loadLastFuelExpense() {
		try {
			const response = await fetch(
				`/api/expenses/vehicles/${vehicleId}/expenses?type=fuel&limit=1`,
				{
					credentials: 'include'
				}
			);

			if (response.ok) {
				const result = await response.json();
				if (result.data && result.data.length > 0) {
					lastFuelExpense = result.data[0];
				}
			}
		} catch (error) {
			console.error('Error loading last fuel expense:', error);
		}
	}

	function handleTypeChange(newType: ExpenseType) {
		formData.type = newType;

		// Auto-select appropriate category
		for (const [category, types] of Object.entries(categoryMapping)) {
			if (types.includes(newType)) {
				formData.category = category as ExpenseCategory;
				break;
			}
		}

		// Clear fuel-specific fields if not fuel
		if (newType !== 'fuel') {
			delete formData.gallons;
			delete formData.mileage;
			showMpgCalculation = false;
			calculatedMpg = null;
		}

		// Clear validation errors
		errors = {};
		touched = {};
	}

	function handleMileageChange() {
		if (
			formData.type === 'fuel' &&
			formData.mileage &&
			formData.gallons &&
			lastFuelExpense?.mileage
		) {
			const milesDriven = formData.mileage - lastFuelExpense.mileage;
			if (milesDriven > 0) {
				calculatedMpg = Math.round((milesDriven / formData.gallons) * 100) / 100;
				showMpgCalculation = true;
			} else {
				calculatedMpg = null;
				showMpgCalculation = false;
			}
		}
	}

	function handleGallonsChange() {
		handleMileageChange(); // Recalculate MPG when gallons change
	}

	function validateField(field: string, value: any): string | null {
		switch (field) {
			case 'amount':
				if (!value || value <= 0) return 'Amount must be greater than 0';
				if (value > 999999) return 'Amount seems too large';
				break;
			case 'date': {
				if (!value) return 'Date is required';
				const selectedDate = new Date(value);
				const today = new Date();
				if (selectedDate > today) return 'Date cannot be in the future';
				break;
			}
			case 'gallons': {
				if (formData.type === 'fuel') {
					if (!value || value <= 0) return 'Gallons required for fuel expenses';
					if (value > 100) return 'Gallons seems too large';
				}
				break;
			}
			case 'mileage':
				if (formData.type === 'fuel') {
					if (!value || value <= 0) return 'Mileage required for fuel expenses';
					if (lastFuelExpense?.mileage && value <= lastFuelExpense.mileage) {
						return 'Mileage must be greater than last fuel entry';
					}
					if (vehicle?.initialMileage && value < vehicle.initialMileage) {
						return 'Mileage cannot be less than initial mileage';
					}
				}
				break;
		}
		return null;
	}

	function handleBlur(field: string) {
		touched[field] = true;
		const error = validateField(field, formData[field as keyof ExpenseFormData]);
		if (error) {
			errors[field] = error;
		} else {
			delete errors[field];
		}
	}

	function validateForm(): boolean {
		const newErrors: Record<string, string> = {};

		// Validate required fields
		const requiredFields = ['amount', 'date'];
		if (formData.type === 'fuel') {
			requiredFields.push('gallons', 'mileage');
		}

		requiredFields.forEach(field => {
			const error = validateField(field, formData[field as keyof ExpenseFormData]);
			if (error) {
				newErrors[field] = error;
			}
		});

		errors = newErrors;
		return Object.keys(newErrors).length === 0;
	}

	async function handleSubmit(event: Event) {
		event.preventDefault();
		if (!validateForm()) {
			// Mark all fields as touched to show errors
			Object.keys(formData).forEach(field => {
				touched[field] = true;
			});
			return;
		}

		isSubmitting = true;

		try {
			const submitData = {
				...formData,
				date: new Date(formData.date).toISOString(),
				currency: 'USD'
			};

			const response = await fetch(`/api/expenses/vehicles/${vehicleId}/expenses`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				credentials: 'include',
				body: JSON.stringify(submitData)
			});

			const result = await response.json();

			if (response.ok) {
				appStore.addNotification({
					type: 'success',
					message: 'Expense added successfully'
				});
				goto(`/vehicles/${vehicleId}`);
			} else {
				appStore.addNotification({
					type: 'error',
					message: result.message || 'Failed to add expense'
				});
			}
		} catch (error) {
			console.error('Error submitting expense:', error);
			appStore.addNotification({
				type: 'error',
				message: 'Network error. Please try again.'
			});
		} finally {
			isSubmitting = false;
		}
	}

	function getVehicleDisplayName(): string {
		if (!vehicle) return '';
		return vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
	}

	function getCategoryIcon(category: ExpenseCategory) {
		switch (category) {
			case 'operating':
				return Fuel;
			case 'maintenance':
				return Wrench;
			case 'financial':
				return CreditCard;
			default:
				return DollarSign;
		}
	}
</script>

<svelte:head>
	<title>Add Expense - {getVehicleDisplayName()} - VROOM Car Tracker</title>
	<meta name="description" content="Add a new expense for your vehicle" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
</svelte:head>

{#if isLoading}
	<div class="flex items-center justify-center py-12">
		<div class="loading-spinner h-8 w-8"></div>
	</div>
{:else if vehicle}
	<div class="max-w-2xl mx-auto space-y-6">
		<!-- Header -->
		<div class="flex items-center gap-4">
			<button onclick={() => goto(`/vehicles/${vehicleId}`)} class="btn btn-secondary p-2">
				<ArrowLeft class="h-4 w-4" />
			</button>
			<div>
				<h1 class="text-2xl font-bold text-gray-900">Add Expense</h1>
				<p class="text-gray-600">{getVehicleDisplayName()}</p>
			</div>
		</div>

		<!-- Expense Form -->
		<form onsubmit={handleSubmit} class="card space-y-6">
			<!-- Expense Type Selection -->
			<fieldset>
				<legend class="block text-sm font-medium text-gray-700 mb-3"> Expense Type </legend>
				<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
					{#each Object.entries(typeLabels) as [type, label]}
						<button
							type="button"
							onclick={() => handleTypeChange(type as ExpenseType)}
							class="p-3 text-sm font-medium rounded-lg border-2 transition-all duration-200 {formData.type ===
							type
								? 'border-primary-500 bg-primary-50 text-primary-700'
								: 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}"
						>
							{label}
						</button>
					{/each}
				</div>
			</fieldset>

			<!-- Category (Auto-selected, but can be changed) -->
			<fieldset>
				<legend class="block text-sm font-medium text-gray-700 mb-3"> Category </legend>
				<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
					{#each Object.entries(categoryLabels) as [category, label]}
						{@const IconComponent = getCategoryIcon(category as ExpenseCategory)}
						<button
							type="button"
							onclick={() => (formData.category = category as ExpenseCategory)}
							class="p-3 text-sm font-medium rounded-lg border-2 transition-all duration-200 flex items-center gap-2 {formData.category ===
							category
								? 'border-primary-500 bg-primary-50 text-primary-700'
								: 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}"
						>
							<IconComponent class="h-4 w-4" />
							{label}
						</button>
					{/each}
				</div>
			</fieldset>

			<!-- Amount -->
			<div>
				<label for="amount" class="block text-sm font-medium text-gray-700 mb-2"> Amount * </label>
				<div class="relative">
					<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
						<DollarSign class="h-5 w-5 text-gray-400" />
					</div>
					<input
						id="amount"
						type="number"
						step="0.01"
						min="0"
						max="999999"
						bind:value={formData.amount}
						onblur={() => handleBlur('amount')}
						class="input pl-10 text-lg font-medium {touched['amount'] && errors['amount']
							? 'border-red-500 focus:border-red-500'
							: ''}"
						placeholder="0.00"
						inputmode="decimal"
						autocomplete="off"
					/>
				</div>
				{#if touched['amount'] && errors['amount']}
					<p class="mt-1 text-sm text-red-600 flex items-center gap-1">
						<AlertCircle class="h-4 w-4" />
						{errors['amount']}
					</p>
				{/if}
			</div>

			<!-- Date -->
			<div>
				<label for="date" class="block text-sm font-medium text-gray-700 mb-2"> Date * </label>
				<div class="relative">
					<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
						<Calendar class="h-5 w-5 text-gray-400" />
					</div>
					<input
						id="date"
						type="date"
						bind:value={formData.date}
						onblur={() => handleBlur('date')}
						max={new Date().toISOString().split('T')[0]}
						class="input pl-10 {touched['date'] && errors['date']
							? 'border-red-500 focus:border-red-500'
							: ''}"
					/>
				</div>
				{#if touched['date'] && errors['date']}
					<p class="mt-1 text-sm text-red-600 flex items-center gap-1">
						<AlertCircle class="h-4 w-4" />
						{errors['date']}
					</p>
				{/if}
			</div>

			<!-- Fuel-specific fields -->
			{#if formData.type === 'fuel'}
				<div class="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-4">
					<div class="flex items-center gap-2 text-blue-700">
						<Fuel class="h-5 w-5" />
						<h3 class="font-medium">Fuel Details</h3>
					</div>

					<!-- Gallons -->
					<div>
						<label for="gallons" class="block text-sm font-medium text-gray-700 mb-2">
							Gallons *
						</label>
						<input
							id="gallons"
							type="number"
							step="0.001"
							min="0"
							max="100"
							bind:value={formData.gallons}
							oninput={handleGallonsChange}
							onblur={() => handleBlur('gallons')}
							class="input {touched['gallons'] && errors['gallons']
								? 'border-red-500 focus:border-red-500'
								: ''}"
							placeholder="0.000"
							inputmode="decimal"
							autocomplete="off"
						/>
						{#if touched['gallons'] && errors['gallons']}
							<p class="mt-1 text-sm text-red-600 flex items-center gap-1">
								<AlertCircle class="h-4 w-4" />
								{errors['gallons']}
							</p>
						{/if}
					</div>

					<!-- Mileage -->
					<div>
						<label for="mileage" class="block text-sm font-medium text-gray-700 mb-2">
							Current Mileage *
						</label>
						<input
							id="mileage"
							type="number"
							min="0"
							bind:value={formData.mileage}
							oninput={handleMileageChange}
							onblur={() => handleBlur('mileage')}
							class="input {touched['mileage'] && errors['mileage']
								? 'border-red-500 focus:border-red-500'
								: ''}"
							placeholder="Current odometer reading"
							inputmode="numeric"
							autocomplete="off"
						/>
						{#if lastFuelExpense?.mileage}
							<p class="mt-1 text-xs text-gray-500">
								Last fuel entry: {lastFuelExpense.mileage.toLocaleString()} miles
							</p>
						{/if}
						{#if touched['mileage'] && errors['mileage']}
							<p class="mt-1 text-sm text-red-600 flex items-center gap-1">
								<AlertCircle class="h-4 w-4" />
								{errors['mileage']}
							</p>
						{/if}
					</div>

					<!-- MPG Calculation -->
					{#if showMpgCalculation && calculatedMpg}
						<div class="bg-green-50 border border-green-200 rounded-lg p-3">
							<div class="flex items-center gap-2 text-green-700">
								<Gauge class="h-4 w-4" />
								<span class="text-sm font-medium">
									Calculated MPG: {calculatedMpg}
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
					{/if}
				</div>
			{/if}

			<!-- Description -->
			<div>
				<label for="description" class="block text-sm font-medium text-gray-700 mb-2">
					Description
				</label>
				<div class="relative">
					<div class="absolute top-3 left-3 pointer-events-none">
						<FileText class="h-5 w-5 text-gray-400" />
					</div>
					<textarea
						id="description"
						bind:value={formData.description}
						rows="3"
						maxlength="500"
						class="input pl-10 resize-none"
						placeholder="Optional notes about this expense..."
					></textarea>
				</div>
				<p class="mt-1 text-xs text-gray-500">
					{formData.description?.length || 0}/500 characters
				</p>
			</div>

			<!-- Submit Button -->
			<div class="flex gap-3 pt-4">
				<button
					type="button"
					onclick={() => goto(`/vehicles/${vehicleId}`)}
					class="btn btn-outline flex-1"
					disabled={isSubmitting}
				>
					Cancel
				</button>
				<button
					type="submit"
					class="btn btn-primary flex-1 flex items-center justify-center gap-2"
					disabled={isSubmitting || Object.keys(errors).length > 0}
				>
					{#if isSubmitting}
						<div class="loading-spinner h-4 w-4"></div>
						Adding...
					{:else}
						<CheckCircle class="h-4 w-4" />
						Add Expense
					{/if}
				</button>
			</div>
		</form>
	</div>
{:else}
	<div class="text-center py-12">
		<AlertCircle class="h-12 w-12 text-gray-400 mx-auto mb-4" />
		<h3 class="text-lg font-medium text-gray-900 mb-2">Vehicle not found</h3>
		<p class="text-gray-600 mb-4">
			The vehicle you're looking for doesn't exist or you don't have access to it.
		</p>
		<button onclick={() => goto('/vehicles')} class="btn btn-primary"> Back to Vehicles </button>
	</div>
{/if}

<style>
	/* Mobile-optimized input styles */
	.input {
		display: block;
		width: 100%;
		padding: 0.75rem;
		border: 1px solid #d1d5db;
		border-radius: 0.5rem;
		box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
		color: #9ca3af;
		outline: none;
		/* Prevent zoom on iOS */
		font-size: 16px;
	}

	.input:focus {
		outline: none;
		border-color: #2563eb;
		box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.5);
	}

	/* Loading spinner */
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

	/* Touch-friendly button sizing */
	@media (max-width: 640px) {
		.btn {
			padding: 0.75rem 1rem;
			font-size: 1rem;
			min-height: 44px; /* iOS recommended touch target */
		}
	}
</style>
