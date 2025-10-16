<script lang="ts">
	import { goto } from '$app/navigation';
	import { appStore } from '$lib/stores/app.js';
	import { ArrowLeft, Car, DollarSign, Calculator } from 'lucide-svelte';
	import DatePicker from '$lib/components/ui/date-picker.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import Checkbox from '$lib/components/ui/checkbox/checkbox.svelte';
	import type {
		VehicleFormData,
		LoanPaymentConfig,
		VehicleFormErrors,
		LoanFormErrors
	} from '$lib/types.js';

	// Form state
	let isSubmitting = $state(false);
	let showLoanForm = $state(false);

	// Vehicle form data
	let vehicleForm = $state<VehicleFormData>({
		make: '',
		model: '',
		year: new Date().getFullYear(),
		licensePlate: '',
		nickname: '',
		initialMileage: undefined,
		purchasePrice: undefined,
		purchaseDate: undefined
	});

	// Loan form data
	let loanForm = $state({
		lender: '',
		originalAmount: 0,
		apr: 0,
		termMonths: 60,
		startDate: undefined as string | undefined,
		paymentAmount: 0,
		frequency: 'monthly' as LoanPaymentConfig['frequency'],
		dayOfMonth: 1
	});

	// Form validation
	let errors = $state<VehicleFormErrors & LoanFormErrors>({});

	// Amortization preview data
	let amortizationPreview = $state<{
		monthlyPayment: number;
		totalInterest: number;
		totalPayments: number;
		payoffDate: Date;
	} | null>(null);

	function validateVehicleForm(): boolean {
		errors = {};

		if (!vehicleForm.make.trim()) {
			errors['make'] = 'Make is required';
		}

		if (!vehicleForm.model.trim()) {
			errors['model'] = 'Model is required';
		}

		if (vehicleForm.year < 1900 || vehicleForm.year > new Date().getFullYear() + 2) {
			errors['year'] = 'Please enter a valid year';
		}

		if (vehicleForm.initialMileage !== undefined && vehicleForm.initialMileage < 0) {
			errors['initialMileage'] = 'Mileage cannot be negative';
		}

		if (vehicleForm.purchasePrice !== undefined && vehicleForm.purchasePrice < 0) {
			errors['purchasePrice'] = 'Purchase price cannot be negative';
		}

		return Object.keys(errors).length === 0;
	}

	function validateLoanForm(): boolean {
		if (!showLoanForm) return true;

		if (!loanForm.lender.trim()) {
			errors['lender'] = 'Lender is required';
		}

		if (loanForm.originalAmount <= 0) {
			errors['originalAmount'] = 'Loan amount must be greater than 0';
		}

		if (loanForm.apr < 0 || loanForm.apr > 50) {
			errors['apr'] = 'APR must be between 0% and 50%';
		}

		if (loanForm.termMonths < 1 || loanForm.termMonths > 360) {
			errors['termMonths'] = 'Term must be between 1 and 360 months';
		}

		if (!loanForm.startDate) {
			errors['startDate'] = 'Start date is required';
		}

		if (loanForm.paymentAmount <= 0) {
			errors['paymentAmount'] = 'Payment amount must be greater than 0';
		}

		return Object.keys(errors).length === 0;
	}

	function calculateAmortization() {
		if (
			!showLoanForm ||
			loanForm.originalAmount <= 0 ||
			loanForm.apr <= 0 ||
			loanForm.termMonths <= 0
		) {
			amortizationPreview = null;
			return;
		}

		const principal = loanForm.originalAmount;
		const monthlyRate = loanForm.apr / 100 / 12;
		const numPayments = loanForm.termMonths;

		// Calculate monthly payment using standard amortization formula
		const monthlyPayment =
			(principal * (monthlyRate * Math.pow(1 + monthlyRate, numPayments))) /
			(Math.pow(1 + monthlyRate, numPayments) - 1);

		const totalPayments = monthlyPayment * numPayments;
		const totalInterest = totalPayments - principal;

		// Calculate payoff date
		const startDate = new Date(loanForm.startDate || new Date());
		const payoffDate = new Date(startDate);
		payoffDate.setMonth(payoffDate.getMonth() + numPayments);

		amortizationPreview = {
			monthlyPayment: Math.round(monthlyPayment * 100) / 100,
			totalInterest: Math.round(totalInterest * 100) / 100,
			totalPayments: Math.round(totalPayments * 100) / 100,
			payoffDate
		};
	}

	// Recalculate when loan parameters change
	$effect(() => {
		// Explicitly track the inputs that should trigger recalculation
		// We copy values to local variables to establish dependencies without tracking the whole object
		const amount = loanForm.originalAmount;
		const apr = loanForm.apr;
		const term = loanForm.termMonths;
		const show = showLoanForm;

		// Also track startDate to ensure changes trigger recalculation
		void loanForm.startDate;

		if (show && amount > 0 && apr >= 0 && term > 0) {
			calculateAmortization();
		} else if (!show) {
			amortizationPreview = null;
		}
	});

	// Sync payment amount from amortization preview (separate effect to avoid circular dependency)
	$effect(() => {
		if (amortizationPreview) {
			loanForm.paymentAmount = amortizationPreview.monthlyPayment;
		}
	});

	async function handleSubmit(event: Event) {
		event.preventDefault();
		if (!validateVehicleForm() || !validateLoanForm()) {
			return;
		}

		isSubmitting = true;

		try {
			// Prepare vehicle data
			const vehicleData: any = {
				...vehicleForm,
				purchaseDate: vehicleForm.purchaseDate ? new Date(vehicleForm.purchaseDate) : undefined
			};

			// Add loan data if provided
			if (showLoanForm && loanForm.lender.trim() && loanForm.startDate) {
				vehicleData.loan = {
					lender: loanForm.lender,
					originalAmount: loanForm.originalAmount,
					currentBalance: loanForm.originalAmount,
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

			const response = await fetch('/api/vehicles', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				credentials: 'include',
				body: JSON.stringify(vehicleData)
			});

			if (response.ok) {
				const newVehicle = await response.json();
				appStore.addVehicle(newVehicle);
				appStore.addNotification({
					type: 'success',
					message: 'Vehicle added successfully!'
				});
				goto('/vehicles');
			} else {
				const errorData = await response.json();
				appStore.addNotification({
					type: 'error',
					message: errorData.message || 'Failed to add vehicle'
				});
			}
		} catch {
			appStore.addNotification({
				type: 'error',
				message: 'Error adding vehicle. Please try again.'
			});
		} finally {
			isSubmitting = false;
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
</script>

<svelte:head>
	<title>Add Vehicle - VROOM Car Tracker</title>
	<meta name="description" content="Add a new vehicle to your fleet" />
</svelte:head>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex items-center gap-4">
		<button onclick={() => goto('/vehicles')} class="btn btn-secondary p-2">
			<ArrowLeft class="h-4 w-4" />
		</button>
		<div>
			<h1 class="text-2xl font-bold text-gray-900">Add New Vehicle</h1>
			<p class="text-gray-600">Enter your vehicle information and optional loan details</p>
		</div>
	</div>

	<form onsubmit={handleSubmit} class="space-y-8">
		<!-- Vehicle Information -->
		<div class="card">
			<div class="flex items-center gap-2 mb-6">
				<Car class="h-5 w-5 text-primary-600" />
				<h2 class="text-lg font-semibold text-gray-900">Vehicle Information</h2>
			</div>

			<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
				<div class="space-y-2">
					<Label for="make">Make *</Label>
					<Input
						id="make"
						type="text"
						placeholder="e.g., Toyota, Honda, Ford"
						bind:value={vehicleForm.make}
						aria-invalid={!!errors['make']}
						required
					/>
					{#if errors['make']}
						<p class="text-sm text-destructive">{errors['make']}</p>
					{/if}
				</div>

				<div class="space-y-2">
					<Label for="model">Model *</Label>
					<Input
						id="model"
						type="text"
						placeholder="e.g., Camry, Civic, F-150"
						bind:value={vehicleForm.model}
						aria-invalid={!!errors['model']}
						required
					/>
					{#if errors['model']}
						<p class="text-sm text-destructive">{errors['model']}</p>
					{/if}
				</div>

				<div class="space-y-2">
					<Label for="year">Year *</Label>
					<Input
						id="year"
						type="number"
						min="1900"
						max={new Date().getFullYear() + 2}
						bind:value={vehicleForm.year}
						aria-invalid={!!errors['year']}
						required
					/>
					{#if errors['year']}
						<p class="text-sm text-destructive">{errors['year']}</p>
					{/if}
				</div>

				<div class="space-y-2">
					<Label for="licensePlate">License Plate</Label>
					<Input
						id="licensePlate"
						type="text"
						placeholder="e.g., ABC-1234"
						bind:value={vehicleForm.licensePlate}
					/>
				</div>

				<div class="space-y-2">
					<Label for="nickname">Nickname</Label>
					<Input
						id="nickname"
						type="text"
						placeholder="e.g., Daily Driver, Weekend Car"
						bind:value={vehicleForm.nickname}
					/>
				</div>

				<div class="space-y-2">
					<Label for="initialMileage">Initial Mileage</Label>
					<Input
						id="initialMileage"
						type="number"
						min="0"
						placeholder="Current odometer reading"
						bind:value={vehicleForm.initialMileage}
						aria-invalid={!!errors['initialMileage']}
					/>
					{#if errors['initialMileage']}
						<p class="text-sm text-destructive">{errors['initialMileage']}</p>
					{/if}
				</div>

				<div class="space-y-2">
					<Label for="purchasePrice">Purchase Price</Label>
					<Input
						id="purchasePrice"
						type="number"
						min="0"
						step="0.01"
						placeholder="0.00"
						bind:value={vehicleForm.purchasePrice}
						aria-invalid={!!errors['purchasePrice']}
					/>
					{#if errors['purchasePrice']}
						<p class="text-sm text-destructive">{errors['purchasePrice']}</p>
					{/if}
				</div>

				<div class="space-y-2">
					<Label for="purchaseDate">Purchase Date</Label>
					<DatePicker
						id="purchaseDate"
						bind:value={vehicleForm.purchaseDate}
						placeholder="Select purchase date"
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
					<Checkbox bind:checked={showLoanForm} />
					<span class="text-sm text-gray-700">This vehicle has a loan</span>
				</label>
			</div>

			{#if showLoanForm}
				<div class="space-y-6">
					<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
						<div class="space-y-2">
							<Label for="lender">Lender *</Label>
							<Input
								id="lender"
								type="text"
								placeholder="e.g., Chase Bank, Credit Union"
								bind:value={loanForm.lender}
								aria-invalid={!!errors['lender']}
								required
							/>
							{#if errors['lender']}
								<p class="text-sm text-destructive">{errors['lender']}</p>
							{/if}
						</div>

						<div class="space-y-2">
							<Label for="originalAmount">Loan Amount *</Label>
							<Input
								id="originalAmount"
								type="number"
								min="0"
								step="0.01"
								placeholder="0.00"
								bind:value={loanForm.originalAmount}
								aria-invalid={!!errors['originalAmount']}
								required
							/>
							{#if errors['originalAmount']}
								<p class="text-sm text-destructive">{errors['originalAmount']}</p>
							{/if}
						</div>

						<div class="space-y-2">
							<Label for="apr">APR (%) *</Label>
							<Input
								id="apr"
								type="number"
								min="0"
								max="50"
								step="0.01"
								placeholder="e.g., 4.5"
								bind:value={loanForm.apr}
								aria-invalid={!!errors['apr']}
								required
							/>
							{#if errors['apr']}
								<p class="text-sm text-destructive">{errors['apr']}</p>
							{/if}
						</div>

						<div class="space-y-2">
							<Label for="termMonths">Term (Months) *</Label>
							<select
								id="termMonths"
								class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
								bind:value={loanForm.termMonths}
								aria-invalid={!!errors['termMonths']}
								required
							>
								<option value={36}>36 months (3 years)</option>
								<option value={48}>48 months (4 years)</option>
								<option value={60}>60 months (5 years)</option>
								<option value={72}>72 months (6 years)</option>
								<option value={84}>84 months (7 years)</option>
							</select>
							{#if errors['termMonths']}
								<p class="text-sm text-destructive">{errors['termMonths']}</p>
							{/if}
						</div>

						<div class="space-y-2">
							<Label for="startDate">Loan Start Date *</Label>
							<DatePicker
								id="startDate"
								bind:value={loanForm.startDate}
								placeholder="Select loan start date"
							/>
							{#if errors['startDate']}
								<p class="text-sm text-destructive">{errors['startDate']}</p>
							{/if}
						</div>

						<div class="space-y-2">
							<Label for="dayOfMonth">Payment Day of Month</Label>
							<select
								id="dayOfMonth"
								class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
								bind:value={loanForm.dayOfMonth}
							>
								{#each Array(28) as _, i}
									<option value={i + 1}>{i + 1}</option>
								{/each}
							</select>
						</div>
					</div>

					<!-- Amortization Preview -->
					{#if amortizationPreview}
						<div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
							<div class="flex items-center gap-2 mb-3">
								<Calculator class="h-4 w-4 text-blue-600" />
								<h3 class="font-medium text-blue-900">Loan Calculation Preview</h3>
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
					Check the box above to add loan information for this vehicle
				</p>
			{/if}
		</div>

		<!-- Form Actions -->
		<div class="flex flex-col sm:flex-row gap-4 sm:justify-end">
			<button
				type="button"
				class="btn btn-secondary"
				onclick={() => goto('/vehicles')}
				disabled={isSubmitting}
			>
				Cancel
			</button>

			<button type="submit" class="btn btn-primary" disabled={isSubmitting}>
				{#if isSubmitting}
					<div class="loading-spinner h-4 w-4 mr-2"></div>
					Adding Vehicle...
				{:else}
					Add Vehicle
				{/if}
			</button>
		</div>
	</form>
</div>
