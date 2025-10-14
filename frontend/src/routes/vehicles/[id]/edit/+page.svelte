<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { appStore } from '$lib/stores/app.js';
	import { ArrowLeft, Car, DollarSign, Calculator, Trash2 } from 'lucide-svelte';
	import type { Vehicle, VehicleFormData, LoanPaymentConfig } from '$lib/types.js';

	const vehicleId = $page.params.id;

	// Component state
	let isLoading = $state(true);
	let isSubmitting = $state(false);
	let isDeleting = $state(false);
	let showDeleteConfirm = $state(false);
	let showLoanForm = $state(false);
	let vehicle = $state<Vehicle | null>(null);

	// Form data
	let vehicleForm = $state<VehicleFormData>({
		make: '',
		model: '',
		year: new Date().getFullYear(),
		licensePlate: '',
		nickname: '',
		initialMileage: undefined,
		purchasePrice: undefined,
		purchaseDate: ''
	});

	let loanForm = $state({
		lender: '',
		originalAmount: 0,
		apr: 0,
		termMonths: 60,
		startDate: '',
		paymentAmount: 0,
		frequency: 'monthly' as LoanPaymentConfig['frequency'],
		dayOfMonth: 1
	});

	// Form validation
	let errors = $state<Record<string, string>>({});

	// Amortization preview
	let amortizationPreview = $state<{
		monthlyPayment: number;
		totalInterest: number;
		totalPayments: number;
		payoffDate: Date;
	} | null>(null);

	onMount(async () => {
		await loadVehicle();
	});

	async function loadVehicle() {
		isLoading = true;
		try {
			const response = await fetch(`/api/vehicles/${vehicleId}`, {
				credentials: 'include'
			});

			if (response.ok) {
				vehicle = await response.json();
				populateForm();
			} else {
				appStore.addNotification({
					type: 'error',
					message: 'Vehicle not found'
				});
				goto('/vehicles');
			}
		} catch (error) {
			appStore.addNotification({
				type: 'error',
				message: 'Error loading vehicle'
			});
			goto('/vehicles');
		} finally {
			isLoading = false;
		}
	}

	function populateForm() {
		if (!vehicle) return;

		vehicleForm = {
			make: vehicle.make,
			model: vehicle.model,
			year: vehicle.year,
			licensePlate: vehicle.licensePlate || '',
			nickname: vehicle.nickname || '',
			initialMileage: vehicle.initialMileage,
			purchasePrice: vehicle.purchasePrice,
			purchaseDate: vehicle.purchaseDate ? new Date(vehicle.purchaseDate).toISOString().split('T')[0] : ''
		};

		if (vehicle.loan?.isActive) {
			showLoanForm = true;
			loanForm = {
				lender: vehicle.loan.lender,
				originalAmount: vehicle.loan.originalAmount,
				apr: vehicle.loan.apr,
				termMonths: vehicle.loan.termMonths,
				startDate: new Date(vehicle.loan.startDate).toISOString().split('T')[0],
				paymentAmount: vehicle.loan.standardPayment.amount,
				frequency: vehicle.loan.standardPayment.frequency,
				dayOfMonth: vehicle.loan.standardPayment.dayOfMonth || 1
			};
		}
	}

	function validateVehicleForm(): boolean {
		errors = {};

		if (!vehicleForm.make.trim()) {
			errors.make = 'Make is required';
		}

		if (!vehicleForm.model.trim()) {
			errors.model = 'Model is required';
		}

		if (vehicleForm.year < 1900 || vehicleForm.year > new Date().getFullYear() + 2) {
			errors.year = 'Please enter a valid year';
		}

		if (vehicleForm.initialMileage !== undefined && vehicleForm.initialMileage < 0) {
			errors.initialMileage = 'Mileage cannot be negative';
		}

		if (vehicleForm.purchasePrice !== undefined && vehicleForm.purchasePrice < 0) {
			errors.purchasePrice = 'Purchase price cannot be negative';
		}

		return Object.keys(errors).length === 0;
	}

	function validateLoanForm(): boolean {
		if (!showLoanForm) return true;

		if (!loanForm.lender.trim()) {
			errors.lender = 'Lender is required';
		}

		if (loanForm.originalAmount <= 0) {
			errors.originalAmount = 'Loan amount must be greater than 0';
		}

		if (loanForm.apr < 0 || loanForm.apr > 50) {
			errors.apr = 'APR must be between 0% and 50%';
		}

		if (loanForm.termMonths < 1 || loanForm.termMonths > 360) {
			errors.termMonths = 'Term must be between 1 and 360 months';
		}

		if (!loanForm.startDate) {
			errors.startDate = 'Start date is required';
		}

		if (loanForm.paymentAmount <= 0) {
			errors.paymentAmount = 'Payment amount must be greater than 0';
		}

		return Object.keys(errors).length === 0;
	}

	function calculateAmortization() {
		if (!showLoanForm || loanForm.originalAmount <= 0 || loanForm.apr <= 0 || loanForm.termMonths <= 0) {
			amortizationPreview = null;
			return;
		}

		const principal = loanForm.originalAmount;
		const monthlyRate = loanForm.apr / 100 / 12;
		const numPayments = loanForm.termMonths;

		const monthlyPayment = principal * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / 
			(Math.pow(1 + monthlyRate, numPayments) - 1);

		const totalPayments = monthlyPayment * numPayments;
		const totalInterest = totalPayments - principal;

		const startDate = new Date(loanForm.startDate || new Date());
		const payoffDate = new Date(startDate);
		payoffDate.setMonth(payoffDate.getMonth() + numPayments);

		amortizationPreview = {
			monthlyPayment: Math.round(monthlyPayment * 100) / 100,
			totalInterest: Math.round(totalInterest * 100) / 100,
			totalPayments: Math.round(totalPayments * 100) / 100,
			payoffDate
		};

		loanForm.paymentAmount = amortizationPreview.monthlyPayment;
	}

	$effect(() => {
		if (showLoanForm) {
			calculateAmortization();
		}
	});

	async function handleSubmit() {
		if (!validateVehicleForm() || !validateLoanForm()) {
			return;
		}

		isSubmitting = true;

		try {
			const vehicleData = {
				...vehicleForm,
				purchaseDate: vehicleForm.purchaseDate ? new Date(vehicleForm.purchaseDate) : undefined
			};

			if (showLoanForm && loanForm.lender.trim()) {
				vehicleData.loan = {
					lender: loanForm.lender,
					originalAmount: loanForm.originalAmount,
					currentBalance: vehicle?.loan?.currentBalance || loanForm.originalAmount,
					apr: loanForm.apr,
					termMonths: loanForm.termMonths,
					startDate: new Date(loanForm.startDate),
					standardPayment: {
						amount: loanForm.paymentAmount,
						frequency: loanForm.frequency,
						dayOfMonth: loanForm.dayOfMonth
					},
					isActive: true
				};
			}

			const response = await fetch(`/api/vehicles/${vehicleId}`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json'
				},
				credentials: 'include',
				body: JSON.stringify(vehicleData)
			});

			if (response.ok) {
				const updatedVehicle = await response.json();
				appStore.updateVehicle(vehicleId, updatedVehicle);
				appStore.addNotification({
					type: 'success',
					message: 'Vehicle updated successfully!'
				});
				goto(`/vehicles/${vehicleId}`);
			} else {
				const errorData = await response.json();
				appStore.addNotification({
					type: 'error',
					message: errorData.message || 'Failed to update vehicle'
				});
			}
		} catch (error) {
			appStore.addNotification({
				type: 'error',
				message: 'Error updating vehicle. Please try again.'
			});
		} finally {
			isSubmitting = false;
		}
	}

	async function handleDelete() {
		if (!showDeleteConfirm) {
			showDeleteConfirm = true;
			return;
		}

		isDeleting = true;

		try {
			const response = await fetch(`/api/vehicles/${vehicleId}`, {
				method: 'DELETE',
				credentials: 'include'
			});

			if (response.ok) {
				appStore.removeVehicle(vehicleId);
				appStore.addNotification({
					type: 'success',
					message: 'Vehicle deleted successfully'
				});
				goto('/vehicles');
			} else {
				const errorData = await response.json();
				appStore.addNotification({
					type: 'error',
					message: errorData.message || 'Failed to delete vehicle'
				});
			}
		} catch (error) {
			appStore.addNotification({
				type: 'error',
				message: 'Error deleting vehicle. Please try again.'
			});
		} finally {
			isDeleting = false;
			showDeleteConfirm = false;
		}
	}

	function formatCurrency(amount: number): string {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD'
		}).format(amount);
	}

	function formatDate(date: Date): string {
		return new Intl.DateTimeFormat('en-US', {
			month: 'long',
			year: 'numeric'
		}).format(date);
	}

	function getVehicleDisplayName(): string {
		if (!vehicle) return '';
		return vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
	}
</script>

<svelte:head>
	<title>Edit {getVehicleDisplayName()} - VROOM Car Tracker</title>
	<meta name="description" content="Edit vehicle information" />
</svelte:head>

{#if isLoading}
	<div class="flex items-center justify-center py-12">
		<div class="loading-spinner h-8 w-8"></div>
	</div>
{:else if vehicle}
	<div class="space-y-6">
		<!-- Header -->
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-4">
				<button 
					onclick={() => goto(`/vehicles/${vehicleId}`)}
					class="btn btn-secondary p-2"
				>
					<ArrowLeft class="h-4 w-4" />
				</button>
				<div>
					<h1 class="text-2xl font-bold text-gray-900">Edit Vehicle</h1>
					<p class="text-gray-600">{getVehicleDisplayName()}</p>
				</div>
			</div>

			<button
				onclick={handleDelete}
				class="btn bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 inline-flex items-center gap-2"
				disabled={isDeleting}
			>
				<Trash2 class="h-4 w-4" />
				{showDeleteConfirm ? 'Confirm Delete' : 'Delete Vehicle'}
			</button>
		</div>

		{#if showDeleteConfirm}
			<div class="bg-red-50 border border-red-200 rounded-lg p-4">
				<p class="text-red-800 font-medium mb-2">Are you sure you want to delete this vehicle?</p>
				<p class="text-red-700 text-sm mb-4">
					This will permanently delete the vehicle and all associated expenses. This action cannot be undone.
				</p>
				<div class="flex gap-2">
					<button
						onclick={() => showDeleteConfirm = false}
						class="btn btn-secondary text-sm"
					>
						Cancel
					</button>
					<button
						onclick={handleDelete}
						class="btn bg-red-600 text-white hover:bg-red-700 text-sm"
						disabled={isDeleting}
					>
						{#if isDeleting}
							<div class="loading-spinner h-3 w-3 mr-1"></div>
							Deleting...
						{:else}
							Yes, Delete Vehicle
						{/if}
					</button>
				</div>
			</div>
		{/if}

		<form onsubmit|preventDefault={handleSubmit} class="space-y-8">
			<!-- Vehicle Information -->
			<div class="card">
				<div class="flex items-center gap-2 mb-6">
					<Car class="h-5 w-5 text-primary-600" />
					<h2 class="text-lg font-semibold text-gray-900">Vehicle Information</h2>
				</div>

				<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
					<div class="form-group">
						<label for="make" class="form-label">Make *</label>
						<input
							id="make"
							type="text"
							class="form-input"
							class:border-red-300={errors.make}
							placeholder="e.g., Toyota, Honda, Ford"
							bind:value={vehicleForm.make}
							required
						/>
						{#if errors.make}
							<p class="form-error">{errors.make}</p>
						{/if}
					</div>

					<div class="form-group">
						<label for="model" class="form-label">Model *</label>
						<input
							id="model"
							type="text"
							class="form-input"
							class:border-red-300={errors.model}
							placeholder="e.g., Camry, Civic, F-150"
							bind:value={vehicleForm.model}
							required
						/>
						{#if errors.model}
							<p class="form-error">{errors.model}</p>
						{/if}
					</div>

					<div class="form-group">
						<label for="year" class="form-label">Year *</label>
						<input
							id="year"
							type="number"
							class="form-input"
							class:border-red-300={errors.year}
							min="1900"
							max={new Date().getFullYear() + 2}
							bind:value={vehicleForm.year}
							required
						/>
						{#if errors.year}
							<p class="form-error">{errors.year}</p>
						{/if}
					</div>

					<div class="form-group">
						<label for="licensePlate" class="form-label">License Plate</label>
						<input
							id="licensePlate"
							type="text"
							class="form-input"
							placeholder="e.g., ABC-1234"
							bind:value={vehicleForm.licensePlate}
						/>
					</div>

					<div class="form-group">
						<label for="nickname" class="form-label">Nickname</label>
						<input
							id="nickname"
							type="text"
							class="form-input"
							placeholder="e.g., Daily Driver, Weekend Car"
							bind:value={vehicleForm.nickname}
						/>
					</div>

					<div class="form-group">
						<label for="initialMileage" class="form-label">Initial Mileage</label>
						<input
							id="initialMileage"
							type="number"
							class="form-input"
							class:border-red-300={errors.initialMileage}
							min="0"
							placeholder="Current odometer reading"
							bind:value={vehicleForm.initialMileage}
						/>
						{#if errors.initialMileage}
							<p class="form-error">{errors.initialMileage}</p>
						{/if}
					</div>

					<div class="form-group">
						<label for="purchasePrice" class="form-label">Purchase Price</label>
						<input
							id="purchasePrice"
							type="number"
							class="form-input"
							class:border-red-300={errors.purchasePrice}
							min="0"
							step="0.01"
							placeholder="0.00"
							bind:value={vehicleForm.purchasePrice}
						/>
						{#if errors.purchasePrice}
							<p class="form-error">{errors.purchasePrice}</p>
						{/if}
					</div>

					<div class="form-group">
						<label for="purchaseDate" class="form-label">Purchase Date</label>
						<input
							id="purchaseDate"
							type="date"
							class="form-input"
							bind:value={vehicleForm.purchaseDate}
						/>
					</div>
				</div>
			</div>

			<!-- Loan Information -->
			<div class="card">
				<div class="flex items-center justify-between mb-6">
					<div class="flex items-center gap-2">
						<DollarSign class="h-5 w-5 text-primary-600" />
						<h2 class="text-lg font-semibold text-gray-900">Loan Information</h2>
					</div>
					<label class="flex items-center gap-2 cursor-pointer">
						<input
							type="checkbox"
							class="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
							bind:checked={showLoanForm}
						/>
						<span class="text-sm text-gray-700">This vehicle has a loan</span>
					</label>
				</div>

				{#if showLoanForm}
					<div class="space-y-6">
						<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
							<div class="form-group">
								<label for="lender" class="form-label">Lender *</label>
								<input
									id="lender"
									type="text"
									class="form-input"
									class:border-red-300={errors.lender}
									placeholder="e.g., Chase Bank, Credit Union"
									bind:value={loanForm.lender}
									required
								/>
								{#if errors.lender}
									<p class="form-error">{errors.lender}</p>
								{/if}
							</div>

							<div class="form-group">
								<label for="originalAmount" class="form-label">Original Loan Amount *</label>
								<input
									id="originalAmount"
									type="number"
									class="form-input"
									class:border-red-300={errors.originalAmount}
									min="0"
									step="0.01"
									placeholder="0.00"
									bind:value={loanForm.originalAmount}
									required
								/>
								{#if errors.originalAmount}
									<p class="form-error">{errors.originalAmount}</p>
								{/if}
							</div>

							<div class="form-group">
								<label for="apr" class="form-label">APR (%) *</label>
								<input
									id="apr"
									type="number"
									class="form-input"
									class:border-red-300={errors.apr}
									min="0"
									max="50"
									step="0.01"
									placeholder="e.g., 4.5"
									bind:value={loanForm.apr}
									required
								/>
								{#if errors.apr}
									<p class="form-error">{errors.apr}</p>
								{/if}
							</div>

							<div class="form-group">
								<label for="termMonths" class="form-label">Term (Months) *</label>
								<select
									id="termMonths"
									class="form-input"
									class:border-red-300={errors.termMonths}
									bind:value={loanForm.termMonths}
									required
								>
									<option value={36}>36 months (3 years)</option>
									<option value={48}>48 months (4 years)</option>
									<option value={60}>60 months (5 years)</option>
									<option value={72}>72 months (6 years)</option>
									<option value={84}>84 months (7 years)</option>
								</select>
								{#if errors.termMonths}
									<p class="form-error">{errors.termMonths}</p>
								{/if}
							</div>

							<div class="form-group">
								<label for="startDate" class="form-label">Loan Start Date *</label>
								<input
									id="startDate"
									type="date"
									class="form-input"
									class:border-red-300={errors.startDate}
									bind:value={loanForm.startDate}
									required
								/>
								{#if errors.startDate}
									<p class="form-error">{errors.startDate}</p>
								{/if}
							</div>

							<div class="form-group">
								<label for="dayOfMonth" class="form-label">Payment Day of Month</label>
								<select
									id="dayOfMonth"
									class="form-input"
									bind:value={loanForm.dayOfMonth}
								>
									{#each Array(28) as _, i}
										<option value={i + 1}>{i + 1}</option>
									{/each}
								</select>
							</div>
						</div>

						<!-- Current Balance Display -->
						{#if vehicle.loan?.currentBalance}
							<div class="bg-gray-50 border border-gray-200 rounded-lg p-4">
								<h3 class="font-medium text-gray-900 mb-2">Current Loan Status</h3>
								<div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
									<div>
										<p class="text-gray-600">Current Balance</p>
										<p class="font-semibold text-gray-900">
											{formatCurrency(vehicle.loan.currentBalance)}
										</p>
									</div>
									<div>
										<p class="text-gray-600">Original Amount</p>
										<p class="font-semibold text-gray-900">
											{formatCurrency(vehicle.loan.originalAmount)}
										</p>
									</div>
									<div>
										<p class="text-gray-600">Amount Paid</p>
										<p class="font-semibold text-gray-900">
											{formatCurrency(vehicle.loan.originalAmount - vehicle.loan.currentBalance)}
										</p>
									</div>
								</div>
							</div>
						{/if}

						<!-- Amortization Preview -->
						{#if amortizationPreview}
							<div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
								<div class="flex items-center gap-2 mb-3">
									<Calculator class="h-4 w-4 text-blue-600" />
									<h3 class="font-medium text-blue-900">Updated Loan Calculation</h3>
								</div>
								
								<div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
									<div>
										<p class="text-blue-700 font-medium">Monthly Payment</p>
										<p class="text-blue-900 font-semibold text-lg">
											{formatCurrency(amortizationPreview.monthlyPayment)}
										</p>
									</div>
									
									<div>
										<p class="text-blue-700 font-medium">Total Interest</p>
										<p class="text-blue-900 font-semibold">
											{formatCurrency(amortizationPreview.totalInterest)}
										</p>
									</div>
									
									<div>
										<p class="text-blue-700 font-medium">Total Payments</p>
										<p class="text-blue-900 font-semibold">
											{formatCurrency(amortizationPreview.totalPayments)}
										</p>
									</div>
									
									<div>
										<p class="text-blue-700 font-medium">Payoff Date</p>
										<p class="text-blue-900 font-semibold">
											{formatDate(amortizationPreview.payoffDate)}
										</p>
									</div>
								</div>
							</div>
						{/if}
					</div>
				{:else}
					<p class="text-gray-500 text-center py-8">
						Check the box above to add or edit loan information for this vehicle
					</p>
				{/if}
			</div>

			<!-- Form Actions -->
			<div class="flex flex-col sm:flex-row gap-4 sm:justify-end">
				<button
					type="button"
					class="btn btn-secondary"
					onclick={() => goto(`/vehicles/${vehicleId}`)}
					disabled={isSubmitting}
				>
					Cancel
				</button>
				
				<button
					type="submit"
					class="btn btn-primary"
					disabled={isSubmitting}
				>
					{#if isSubmitting}
						<div class="loading-spinner h-4 w-4 mr-2"></div>
						Updating Vehicle...
					{:else}
						Update Vehicle
					{/if}
				</button>
			</div>
		</form>
	</div>
{:else}
	<div class="text-center py-12">
		<p class="text-gray-500">Vehicle not found</p>
		<button 
			onclick={() => goto('/vehicles')}
			class="btn btn-primary mt-4"
		>
			Back to Vehicles
		</button>
	</div>
{/if}