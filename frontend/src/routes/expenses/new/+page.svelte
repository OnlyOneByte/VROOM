<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { isOnline } from '$lib/stores/offline';
	import { addOfflineExpense } from '$lib/utils/offline-storage';
	import { requestBackgroundSync } from '$lib/utils/pwa';
	import { appStore } from '$lib/stores/app';
	import { Save, ArrowLeft, Fuel, Wrench, DollarSign, FileText } from 'lucide-svelte';
	import type { ExpenseFormErrors } from '$lib/types.js';

	// Get URL parameters
	let returnTo = $state('/expenses');
	let preselectedVehicleId = $state<string | null>(null);

	// Form data
	let formData = {
		vehicleId: '',
		type: '',
		category: '',
		amount: '',
		date: new Date().toISOString().split('T')[0],
		mileage: '',
		gallons: '',
		description: ''
	};

	// Update from URL params
	$effect(() => {
		const params = $page.url.searchParams;
		returnTo = params.get('returnTo') || '/expenses';
		preselectedVehicleId = params.get('vehicleId');
		if (preselectedVehicleId && !formData.vehicleId) {
			formData.vehicleId = preselectedVehicleId;
		}
	});

	// Form state
	let isSubmitting = false;
	let vehicles: any[] = [];
	let errors: ExpenseFormErrors = {};

	// Expense types and categories
	const expenseTypes = [
		{ value: 'fuel', label: 'Fuel', icon: Fuel, category: 'operating' },
		{ value: 'maintenance', label: 'Maintenance', icon: Wrench, category: 'maintenance' },
		{ value: 'repairs', label: 'Repairs', icon: Wrench, category: 'maintenance' },
		{ value: 'insurance', label: 'Insurance', icon: FileText, category: 'financial' },
		{ value: 'registration', label: 'Registration', icon: FileText, category: 'regulatory' },
		{ value: 'tolls', label: 'Tolls', icon: DollarSign, category: 'operating' },
		{ value: 'parking', label: 'Parking', icon: DollarSign, category: 'operating' },
		{ value: 'other', label: 'Other', icon: DollarSign, category: 'operating' }
	];

	const categories = [
		{ value: 'operating', label: 'Operating Costs', description: 'Day-to-day driving costs' },
		{ value: 'maintenance', label: 'Maintenance', description: 'Keeping the car running' },
		{ value: 'financial', label: 'Financial', description: 'Loans, insurance' },
		{ value: 'regulatory', label: 'Regulatory', description: 'Government-required' },
		{ value: 'enhancement', label: 'Enhancement', description: 'Optional improvements' },
		{ value: 'convenience', label: 'Convenience', description: 'Nice-to-have' }
	];

	onMount(async () => {
		// Load vehicles
		try {
			const response = await fetch('/api/vehicles');
			if (response.ok) {
				const result = await response.json();
				vehicles = result.data || [];
				if (vehicles.length > 0) {
					formData.vehicleId = vehicles[0].id;
				}
			}
		} catch (error) {
			console.error('Failed to load vehicles:', error);
		}
	});

	// Auto-set category when type changes
	$effect(() => {
		if (formData.type) {
			const selectedType = expenseTypes.find(t => t.value === formData.type);
			if (selectedType) {
				formData.category = selectedType.category;
			}
		}
	});

	// Show fuel-specific fields
	let showFuelFields = $derived(formData.type === 'fuel');

	function validateForm(): boolean {
		errors = {};

		if (!formData.vehicleId) {
			errors['vehicleId'] = 'Please select a vehicle';
		}

		if (!formData.type) {
			errors['type'] = 'Please select an expense type';
		}

		if (!formData.amount || parseFloat(formData.amount) <= 0) {
			errors['amount'] = 'Please enter a valid amount';
		}

		if (!formData.date) {
			errors['date'] = 'Please select a date';
		}

		if (showFuelFields) {
			if (!formData.gallons || parseFloat(formData.gallons) <= 0) {
				errors['gallons'] = 'Please enter gallons for fuel expenses';
			}

			if (!formData.mileage || parseInt(formData.mileage) <= 0) {
				errors['mileage'] = 'Please enter current mileage for fuel expenses';
			}
		}

		return Object.keys(errors).length === 0;
	}

	async function handleSubmit() {
		if (!validateForm()) {
			return;
		}

		isSubmitting = true;

		try {
			const expenseData = {
				vehicleId: formData.vehicleId,
				type: formData.type,
				category: formData.category,
				amount: parseFloat(formData.amount),
				date: formData.date ? new Date(formData.date).toISOString() : new Date().toISOString(),
				mileage: formData.mileage ? parseInt(formData.mileage) : undefined,
				gallons: formData.gallons ? parseFloat(formData.gallons) : undefined,
				description: formData.description || undefined
			};

			if ($isOnline) {
				// Try to submit directly
				const response = await fetch(`/api/expenses`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
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
					type: expenseData.type,
					category: expenseData.category,
					amount: expenseData.amount,
					date: expenseData.date ?? '',
					description: expenseData.description ?? '',
					...(expenseData.mileage !== undefined && { mileage: expenseData.mileage }),
					...(expenseData.gallons !== undefined && { gallons: expenseData.gallons })
				});

				// Request background sync
				requestBackgroundSync('expense-sync');

				appStore.addNotification({
					type: 'info',
					message: 'Expense saved offline. Will sync when online.'
				});

				goto(returnTo);
			}
		} catch (error) {
			console.error('Failed to save expense:', error);

			// Save offline as fallback
			const expenseData = {
				vehicleId: formData.vehicleId,
				type: formData.type,
				category: formData.category,
				amount: parseFloat(formData.amount),
				date: formData.date,
				mileage: formData.mileage ? parseInt(formData.mileage) : undefined,
				gallons: formData.gallons ? parseFloat(formData.gallons) : undefined,
				description: formData.description || undefined
			};

			addOfflineExpense({
				vehicleId: expenseData.vehicleId,
				type: expenseData.type,
				category: expenseData.category,
				amount: expenseData.amount,
				date: expenseData.date ?? '',
				description: expenseData.description ?? '',
				...(expenseData.mileage !== undefined && { mileage: expenseData.mileage }),
				...(expenseData.gallons !== undefined && { gallons: expenseData.gallons })
			});
			requestBackgroundSync('expense-sync');

			appStore.addNotification({
				type: 'warning',
				message: 'Saved offline due to connection issue. Will sync when online.'
			});

			goto(returnTo);
		} finally {
			isSubmitting = false;
		}
	}
</script>

<svelte:head>
	<title>Add Expense - VROOM Car Tracker</title>
	<meta name="description" content="Add a new vehicle expense" />
</svelte:head>

<div class="max-w-2xl mx-auto space-y-6">
	<!-- Header -->
	<div class="flex items-center gap-4">
		<button on:click={() => goto(returnTo)} class="p-2 hover:bg-gray-100 rounded-lg">
			<ArrowLeft class="h-5 w-5" />
		</button>

		<div>
			<h1 class="text-2xl font-bold text-gray-900">Add Expense</h1>
			<p class="text-gray-600">
				{#if !$isOnline}
					<span class="text-orange-600">Offline mode - will sync when online</span>
				{:else}
					Track a new vehicle expense
				{/if}
			</p>
		</div>
	</div>

	<!-- Form -->
	<form on:submit|preventDefault={handleSubmit} class="card space-y-6">
		<!-- Vehicle Selection -->
		<div>
			<label for="vehicle" class="block text-sm font-medium text-gray-700 mb-2"> Vehicle * </label>
			<select
				id="vehicle"
				bind:value={formData.vehicleId}
				class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
				class:border-red-300={errors['vehicleId']}
			>
				<option value="">Select a vehicle</option>
				{#each vehicles as vehicle}
					<option value={vehicle.id}>
						{vehicle.year}
						{vehicle.make}
						{vehicle.model}
						{#if vehicle.nickname}({vehicle.nickname}){/if}
					</option>
				{/each}
			</select>
			{#if errors['vehicleId']}
				<p class="text-red-600 text-sm mt-1">{errors['vehicleId']}</p>
			{/if}
		</div>

		<!-- Expense Type -->
		<fieldset>
			<legend class="block text-sm font-medium text-gray-700 mb-2"> Expense Type * </legend>
			<div
				class="grid grid-cols-2 sm:grid-cols-4 gap-2"
				role="radiogroup"
				aria-labelledby="expense-type-legend"
			>
				{#each expenseTypes as type}
					<button
						type="button"
						role="radio"
						aria-checked={formData.type === type.value}
						on:click={() => (formData.type = type.value)}
						class="p-3 border rounded-lg text-center hover:bg-gray-50 transition-colors"
						class:border-blue-500={formData.type === type.value}
						class:bg-blue-50={formData.type === type.value}
						class:border-red-300={errors['type']}
					>
						<svelte:component this={type.icon} class="h-5 w-5 mx-auto mb-1" />
						<div class="text-xs font-medium">{type.label}</div>
					</button>
				{/each}
			</div>
			{#if errors['type']}
				<p class="text-red-600 text-sm mt-1">{errors['type']}</p>
			{/if}
		</fieldset>

		<!-- Category (auto-selected but can be changed) -->
		<div>
			<label for="category" class="block text-sm font-medium text-gray-700 mb-2"> Category </label>
			<select
				id="category"
				bind:value={formData.category}
				class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
			>
				{#each categories as category}
					<option value={category.value}>
						{category.label} - {category.description}
					</option>
				{/each}
			</select>
		</div>

		<!-- Amount -->
		<div>
			<label for="amount" class="block text-sm font-medium text-gray-700 mb-2"> Amount * </label>
			<div class="relative">
				<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
					<span class="text-gray-500">$</span>
				</div>
				<input
					id="amount"
					type="number"
					step="0.01"
					min="0"
					bind:value={formData.amount}
					placeholder="0.00"
					class="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
					class:border-red-300={errors['amount']}
				/>
			</div>
			{#if errors['amount']}
				<p class="text-red-600 text-sm mt-1">{errors['amount']}</p>
			{/if}
		</div>

		<!-- Date -->
		<div>
			<label for="date" class="block text-sm font-medium text-gray-700 mb-2"> Date * </label>
			<input
				id="date"
				type="date"
				bind:value={formData.date}
				class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
				class:border-red-300={errors['date']}
			/>
			{#if errors['date']}
				<p class="text-red-600 text-sm mt-1">{errors['date']}</p>
			{/if}
		</div>

		<!-- Mileage (always visible, required for fuel) -->
		<div>
			<label for="mileage" class="block text-sm font-medium text-gray-700 mb-2">
				Current Mileage {showFuelFields ? '*' : '(Optional)'}
			</label>
			<input
				id="mileage"
				type="number"
				min="0"
				bind:value={formData.mileage}
				placeholder="123456"
				class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
				class:border-red-300={errors['mileage']}
			/>
			{#if errors['mileage']}
				<p class="text-red-600 text-sm mt-1">{errors['mileage']}</p>
			{/if}
		</div>

		<!-- Fuel-specific fields -->
		{#if showFuelFields}
			<div class="p-4 bg-blue-50 rounded-lg space-y-4">
				<div>
					<label for="gallons" class="block text-sm font-medium text-gray-700 mb-2">
						Gallons *
					</label>
					<input
						id="gallons"
						type="number"
						step="0.001"
						min="0"
						bind:value={formData.gallons}
						placeholder="0.000"
						class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
						class:border-red-300={errors['gallons']}
					/>
					{#if errors['gallons']}
						<p class="text-red-600 text-sm mt-1">{errors['gallons']}</p>
					{/if}
				</div>

				{#if formData.gallons && formData.amount}
					<div class="text-sm text-gray-600">
						<strong>Price per gallon:</strong> ${(
							parseFloat(formData.amount) / parseFloat(formData.gallons)
						).toFixed(3)}
					</div>
				{/if}
			</div>
		{/if}

		<!-- Description -->
		<div>
			<label for="description" class="block text-sm font-medium text-gray-700 mb-2">
				Description (Optional)
			</label>
			<textarea
				id="description"
				bind:value={formData.description}
				rows="3"
				placeholder="Add any additional notes..."
				class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
			></textarea>
		</div>

		<!-- Submit Button -->
		<div class="flex gap-3 pt-4">
			<button
				type="submit"
				disabled={isSubmitting}
				class="flex-1 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white px-4 py-2 rounded-lg font-medium flex items-center justify-center gap-2"
			>
				{#if isSubmitting}
					<div
						class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"
					></div>
					Saving...
				{:else}
					<Save class="h-4 w-4" />
					{$isOnline ? 'Save Expense' : 'Save Offline'}
				{/if}
			</button>

			<button
				type="button"
				on:click={() => goto('/expenses')}
				class="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium"
			>
				Cancel
			</button>
		</div>
	</form>
</div>
