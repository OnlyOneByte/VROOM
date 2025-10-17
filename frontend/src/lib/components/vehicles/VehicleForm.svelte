<script lang="ts">
	import { goto } from '$app/navigation';
	import { appStore } from '$lib/stores/app.js';
	import { ArrowLeft, Car, DollarSign, Calculator, Trash2, X, Check } from 'lucide-svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import DatePicker from '$lib/components/ui/date-picker.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import Switch from '$lib/components/ui/switch/switch.svelte';
	import * as Select from '$lib/components/ui/select';
	import { FormFieldError } from '$lib/components/ui/form-field';
	import {
		AlertDialog,
		AlertDialogAction,
		AlertDialogCancel,
		AlertDialogContent,
		AlertDialogDescription,
		AlertDialogFooter,
		AlertDialogHeader,
		AlertDialogTitle
	} from '$lib/components/ui/alert-dialog';
	import type {
		Vehicle,
		VehicleFormData,
		LoanPaymentConfig,
		VehicleFormErrors,
		LoanFormErrors
	} from '$lib/types.js';

	interface Props {
		vehicleId?: string;
	}

	let { vehicleId }: Props = $props();

	// Determine mode
	const isEditMode = $derived(!!vehicleId);

	// Component state
	let isLoading = $state(!!vehicleId);
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
		startDate: undefined as string | undefined,
		paymentAmount: 0,
		frequency: 'monthly' as LoanPaymentConfig['frequency'],
		dayOfMonth: 1
	});

	// Form validation
	let errors = $state<VehicleFormErrors & LoanFormErrors>({});

	// Amortization preview
	let amortizationPreview = $state<{
		monthlyPayment: number;
		totalInterest: number;
		totalPayments: number;
		payoffDate: Date;
	} | null>(null);

	// Load vehicle data if in edit mode
	$effect(() => {
		if (isEditMode && vehicleId) {
			loadVehicle();
		}
	});

	async function loadVehicle() {
		isLoading = true;
		try {
			// Fetch vehicle data
			const vehicleResponse = await fetch(`/api/vehicles/${vehicleId}`, {
				credentials: 'include'
			});

			if (!vehicleResponse.ok) {
				appStore.addNotification({
					type: 'error',
					message: 'Vehicle not found'
				});
				goto('/vehicles');
				return;
			}

			const vehicleResult = await vehicleResponse.json();
			vehicle = vehicleResult.data;

			// Fetch loan data separately
			const loanResponse = await fetch(`/api/loans/vehicles/${vehicleId}/loan`, {
				credentials: 'include'
			});

			if (loanResponse.ok) {
				const loanResult = await loanResponse.json();
				if (loanResult.data && vehicle) {
					// Attach loan to vehicle object for populateForm
					vehicle.loan = loanResult.data;
				}
			}

			populateForm();
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

	function populateForm() {
		if (!vehicle) return;

		// Replace the entire object to ensure reactivity
		vehicleForm = {
			make: vehicle.make,
			model: vehicle.model,
			year: vehicle.year,
			licensePlate: vehicle.licensePlate || '',
			nickname: vehicle.nickname || '',
			initialMileage: vehicle.initialMileage,
			purchasePrice: vehicle.purchasePrice,
			purchaseDate: vehicle.purchaseDate
				? new Date(vehicle.purchaseDate).toISOString().split('T')[0]
				: ''
		};

		if (vehicle.loan?.isActive) {
			showLoanForm = true;
			loanForm = {
				lender: vehicle.loan.lender,
				originalAmount: vehicle.loan.originalAmount,
				apr: vehicle.loan.apr,
				termMonths: vehicle.loan.termMonths,
				startDate: new Date(vehicle.loan.startDate).toISOString().split('T')[0]!,
				paymentAmount: vehicle.loan.paymentAmount,
				frequency: vehicle.loan.paymentFrequency,
				dayOfMonth: vehicle.loan.paymentDayOfMonth || 1
			};
		}
	}

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

		const monthlyPayment =
			(principal * (monthlyRate * Math.pow(1 + monthlyRate, numPayments))) /
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
	}

	// Recalculate when loan parameters change
	$effect(() => {
		const amount = loanForm.originalAmount;
		const apr = loanForm.apr;
		const term = loanForm.termMonths;
		const show = showLoanForm;

		void loanForm.startDate;

		if (show && amount > 0 && apr >= 0 && term > 0) {
			calculateAmortization();
		} else if (!show) {
			amortizationPreview = null;
		}
	});

	// Sync payment amount from amortization preview
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
			// Prepare vehicle data (dates as ISO strings, clean up null values)
			const vehicleData: any = {
				make: vehicleForm.make,
				model: vehicleForm.model,
				year: vehicleForm.year,
				licensePlate: vehicleForm.licensePlate || undefined,
				nickname: vehicleForm.nickname || undefined,
				initialMileage: vehicleForm.initialMileage ?? undefined,
				purchasePrice: vehicleForm.purchasePrice ?? undefined,
				purchaseDate: vehicleForm.purchaseDate
					? new Date(vehicleForm.purchaseDate).toISOString()
					: undefined
			};

			console.log('Submitting vehicle data:', vehicleData);

			// Update/create vehicle
			const vehicleUrl = isEditMode ? `/api/vehicles/${vehicleId}` : '/api/vehicles';
			const vehicleMethod = isEditMode ? 'PUT' : 'POST';

			const vehicleResponse = await fetch(vehicleUrl, {
				method: vehicleMethod,
				headers: {
					'Content-Type': 'application/json'
				},
				credentials: 'include',
				body: JSON.stringify(vehicleData)
			});

			if (!vehicleResponse.ok) {
				const errorData = await vehicleResponse.json();
				console.error('Vehicle update error:', errorData);
				appStore.addNotification({
					type: 'error',
					message: errorData.message || `Failed to ${isEditMode ? 'update' : 'add'} vehicle`
				});
				return;
			}

			const savedVehicleResponse = await vehicleResponse.json();
			const savedVehicle = savedVehicleResponse.data || savedVehicleResponse;
			const finalVehicleId = isEditMode ? vehicleId! : savedVehicle.id;

			// Handle loan data separately if provided
			if (showLoanForm && loanForm.lender.trim() && loanForm.startDate) {
				const loanData = {
					lender: loanForm.lender,
					originalAmount: Number(loanForm.originalAmount),
					apr: Number(loanForm.apr),
					termMonths: Number(loanForm.termMonths),
					startDate: new Date(loanForm.startDate).toISOString(),
					paymentAmount: Number(loanForm.paymentAmount),
					paymentFrequency: loanForm.frequency,
					paymentDayOfMonth: Number(loanForm.dayOfMonth)
				};

				const loanResponse = await fetch(`/api/loans/vehicles/${finalVehicleId}/loan`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					credentials: 'include',
					body: JSON.stringify(loanData)
				});

				if (!loanResponse.ok) {
					const errorData = await loanResponse.json();
					appStore.addNotification({
						type: 'warning',
						message: `Vehicle saved but loan failed: ${errorData.message || 'Unknown error'}`
					});
				}
			}

			// Update store and navigate
			if (isEditMode) {
				appStore.updateVehicle(vehicleId!, savedVehicle);
				appStore.addNotification({
					type: 'success',
					message: 'Vehicle updated successfully!'
				});
				goto(`/vehicles/${vehicleId}`);
			} else {
				appStore.addVehicle(savedVehicle);
				appStore.addNotification({
					type: 'success',
					message: 'Vehicle added successfully!'
				});
				goto('/vehicles');
			}
		} catch (error) {
			console.error('Error submitting vehicle:', error);
			appStore.addNotification({
				type: 'error',
				message: `Error ${isEditMode ? 'updating' : 'adding'} vehicle. Please try again.`
			});
		} finally {
			isSubmitting = false;
		}
	}

	function confirmDelete() {
		showDeleteConfirm = true;
	}

	async function handleDelete() {
		isDeleting = true;

		try {
			const response = await fetch(`/api/vehicles/${vehicleId}`, {
				method: 'DELETE',
				credentials: 'include'
			});

			if (response.ok) {
				appStore.removeVehicle(vehicleId!);
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
		} catch {
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

	function handleBack() {
		if (isEditMode) {
			goto(`/vehicles/${vehicleId}`);
		} else {
			goto('/vehicles');
		}
	}
</script>

{#if isLoading}
	<div class="flex items-center justify-center py-12">
		<div class="loading-spinner h-8 w-8"></div>
	</div>
{:else}
	<div class="space-y-6">
		<!-- Header -->
		<div class="flex items-center gap-4">
			<button onclick={handleBack} class="btn btn-secondary p-2">
				<ArrowLeft class="h-4 w-4" />
			</button>
			<div>
				<h1 class="text-2xl font-bold text-gray-900">
					{isEditMode ? 'Edit Vehicle' : 'Add New Vehicle'}
				</h1>
				{#if isEditMode && vehicleForm.make && vehicleForm.model}
					<p class="text-gray-600">
						{vehicleForm.nickname || `${vehicleForm.year} ${vehicleForm.make} ${vehicleForm.model}`}
					</p>
				{:else if !isEditMode}
					<p class="text-gray-600">Enter your vehicle information and optional loan details</p>
				{/if}
			</div>
		</div>

		<form onsubmit={handleSubmit} class="space-y-8 pb-32 sm:pb-24">
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
							aria-describedby={errors['make'] ? 'make-error' : undefined}
							required
						/>
						{#if errors['make']}
							<FormFieldError id="make-error">{errors['make']}</FormFieldError>
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
							aria-describedby={errors['model'] ? 'model-error' : undefined}
							required
						/>
						{#if errors['model']}
							<FormFieldError id="model-error">{errors['model']}</FormFieldError>
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
							aria-describedby={errors['year'] ? 'year-error' : undefined}
							required
						/>
						{#if errors['year']}
							<FormFieldError id="year-error">{errors['year']}</FormFieldError>
						{/if}
					</div>

					<div class="space-y-2">
						<Label for="licensePlate">License Plate</Label>
						<Input
							id="licensePlate"
							type="text"
							placeholder="e.g., ABC-1234"
							bind:value={vehicleForm.licensePlate}
							aria-invalid={!!errors['licensePlate']}
							aria-describedby={errors['licensePlate'] ? 'licensePlate-error' : undefined}
						/>
						{#if errors['licensePlate']}
							<FormFieldError id="licensePlate-error">{errors['licensePlate']}</FormFieldError>
						{/if}
					</div>

					<div class="space-y-2">
						<Label for="nickname">Nickname</Label>
						<Input
							id="nickname"
							type="text"
							placeholder="e.g., Daily Driver, Weekend Car"
							bind:value={vehicleForm.nickname}
							aria-invalid={!!errors['nickname']}
							aria-describedby={errors['nickname'] ? 'nickname-error' : undefined}
						/>
						{#if errors['nickname']}
							<FormFieldError id="nickname-error">{errors['nickname']}</FormFieldError>
						{/if}
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
							aria-describedby={errors['initialMileage'] ? 'initialMileage-error' : undefined}
						/>
						{#if errors['initialMileage']}
							<FormFieldError id="initialMileage-error">{errors['initialMileage']}</FormFieldError>
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
							aria-describedby={errors['purchasePrice'] ? 'purchasePrice-error' : undefined}
						/>
						{#if errors['purchasePrice']}
							<FormFieldError id="purchasePrice-error">{errors['purchasePrice']}</FormFieldError>
						{/if}
					</div>

					<div class="space-y-2">
						<Label for="purchaseDate">Purchase Date</Label>
						<DatePicker
							id="purchaseDate"
							bind:value={vehicleForm.purchaseDate}
							placeholder="Select purchase date"
							aria-invalid={!!errors['purchaseDate']}
							aria-describedby={errors['purchaseDate'] ? 'purchaseDate-error' : undefined}
						/>
						{#if errors['purchaseDate']}
							<FormFieldError id="purchaseDate-error">{errors['purchaseDate']}</FormFieldError>
						{/if}
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
					<div class="flex items-center gap-2">
						<Switch bind:checked={showLoanForm} id="loan-toggle" />
						<Label for="loan-toggle" class="text-sm text-gray-700 cursor-pointer"
							>This vehicle has a loan</Label
						>
					</div>
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
									aria-describedby={errors['lender'] ? 'lender-error' : undefined}
									required
								/>
								{#if errors['lender']}
									<FormFieldError id="lender-error">{errors['lender']}</FormFieldError>
								{/if}
							</div>

							<div class="space-y-2">
								<Label for="originalAmount">{isEditMode ? 'Original ' : ''}Loan Amount *</Label>
								<Input
									id="originalAmount"
									type="number"
									min="0"
									step="0.01"
									placeholder="0.00"
									bind:value={loanForm.originalAmount}
									aria-invalid={!!errors['originalAmount']}
									aria-describedby={errors['originalAmount'] ? 'originalAmount-error' : undefined}
									required
								/>
								{#if errors['originalAmount']}
									<FormFieldError id="originalAmount-error"
										>{errors['originalAmount']}</FormFieldError
									>
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
									aria-describedby={errors['apr'] ? 'apr-error' : undefined}
									required
								/>
								{#if errors['apr']}
									<FormFieldError id="apr-error">{errors['apr']}</FormFieldError>
								{/if}
							</div>

							<div class="space-y-2">
								<Label for="termMonths">Term (Months) *</Label>
								<Select.Root
									type="single"
									value={String(loanForm.termMonths)}
									onValueChange={v => {
										if (v) {
											loanForm.termMonths = Number(v);
										}
									}}
								>
									<Select.Trigger
										id="termMonths"
										class="w-full"
										aria-invalid={!!errors['termMonths']}
										aria-describedby={errors['termMonths'] ? 'termMonths-error' : undefined}
									>
										{loanForm.termMonths} months ({Math.floor(loanForm.termMonths / 12)} years)
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="36" label="36 months (3 years)"
											>36 months (3 years)</Select.Item
										>
										<Select.Item value="48" label="48 months (4 years)"
											>48 months (4 years)</Select.Item
										>
										<Select.Item value="60" label="60 months (5 years)"
											>60 months (5 years)</Select.Item
										>
										<Select.Item value="72" label="72 months (6 years)"
											>72 months (6 years)</Select.Item
										>
										<Select.Item value="84" label="84 months (7 years)"
											>84 months (7 years)</Select.Item
										>
									</Select.Content>
								</Select.Root>
								{#if errors['termMonths']}
									<FormFieldError id="termMonths-error">{errors['termMonths']}</FormFieldError>
								{/if}
							</div>

							<div class="space-y-2">
								<Label for="startDate">Loan Start Date *</Label>
								<DatePicker
									id="startDate"
									bind:value={loanForm.startDate}
									placeholder="Select loan start date"
									aria-invalid={!!errors['startDate']}
									aria-describedby={errors['startDate'] ? 'startDate-error' : undefined}
								/>
								{#if errors['startDate']}
									<FormFieldError id="startDate-error">{errors['startDate']}</FormFieldError>
								{/if}
							</div>

							<div class="space-y-2">
								<Label for="dayOfMonth">Payment Day of Month</Label>
								<Select.Root
									type="single"
									value={String(loanForm.dayOfMonth)}
									onValueChange={v => {
										if (v) {
											loanForm.dayOfMonth = Number(v);
										}
									}}
								>
									<Select.Trigger
										id="dayOfMonth"
										class="w-full"
										aria-invalid={!!errors['dayOfMonth']}
										aria-describedby={errors['dayOfMonth'] ? 'dayOfMonth-error' : undefined}
									>
										{loanForm.dayOfMonth}
									</Select.Trigger>
									<Select.Content>
										{#each Array(28) as _, i}
											<Select.Item value={String(i + 1)} label={String(i + 1)}>{i + 1}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
								{#if errors['dayOfMonth']}
									<FormFieldError id="dayOfMonth-error">{errors['dayOfMonth']}</FormFieldError>
								{/if}
							</div>
						</div>

						<!-- Current Balance Display (Edit Mode Only) -->
						{#if isEditMode && vehicle?.loan?.currentBalance}
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
									<h3 class="font-medium text-blue-900">
										{isEditMode ? 'Updated ' : ''}Loan Calculation Preview
									</h3>
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
						Check the box above to {isEditMode ? 'add or edit' : 'add'} loan information for this vehicle
					</p>
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
						<span class="font-bold">{isEditMode ? 'Updating' : 'Adding'}...</span>
					{:else}
						<Check class="h-5 w-5 mr-2 transition-transform duration-300 group-hover:scale-110" />
						<span class="font-bold">{isEditMode ? 'Update' : 'Add'} Vehicle</span>
					{/if}
				</Button>
			</div>
		</div>
	</div>

	<!-- Delete Confirmation AlertDialog -->
	<AlertDialog bind:open={showDeleteConfirm}>
		<AlertDialogContent>
			<AlertDialogHeader>
				<AlertDialogTitle>Delete Vehicle</AlertDialogTitle>
				<AlertDialogDescription>
					Are you sure you want to delete this vehicle? This will permanently delete the vehicle and
					all associated expenses. This action cannot be undone.
				</AlertDialogDescription>
			</AlertDialogHeader>

			{#if vehicle}
				<div class="bg-gray-50 rounded-lg p-3">
					<div class="flex items-center gap-3">
						<div class="p-2 rounded-lg bg-red-100 text-red-600">
							<Car class="h-4 w-4" />
						</div>
						<div>
							<p class="font-medium text-gray-900">
								{vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}`}
							</p>
							<p class="text-sm text-gray-600">
								{vehicle.year}
								{vehicle.make}
								{vehicle.model}
							</p>
						</div>
					</div>
				</div>
			{/if}

			<AlertDialogFooter>
				<AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
				<AlertDialogAction
					onclick={handleDelete}
					disabled={isDeleting}
					class="bg-red-600 hover:bg-red-700 text-white"
				>
					{#if isDeleting}
						<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
						Deleting...
					{:else}
						<Trash2 class="h-4 w-4 mr-2" />
						Delete Vehicle
					{/if}
				</AlertDialogAction>
			</AlertDialogFooter>
		</AlertDialogContent>
	</AlertDialog>
{/if}
