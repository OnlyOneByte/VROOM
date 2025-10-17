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
		FinancingPaymentConfig,
		VehicleFormErrors,
		FinancingFormErrors
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
	let showFinancingForm = $state(false);
	let vehicle = $state<Vehicle | null>(null);

	// Form data
	let vehicleForm = $state<VehicleFormData>({
		make: '',
		model: '',
		year: new Date().getFullYear(),
		vehicleType: 'gas',
		licensePlate: '',
		nickname: '',
		initialMileage: undefined,
		purchasePrice: undefined,
		purchaseDate: ''
	});

	let financingForm = $state({
		financingType: 'loan' as 'loan' | 'lease' | 'own',
		provider: '',
		originalAmount: 0,
		apr: 0,
		termMonths: 60,
		startDate: undefined as string | undefined,
		paymentAmount: 0,
		frequency: 'monthly' as FinancingPaymentConfig['frequency'],
		dayOfMonth: 1,
		residualValue: undefined as number | undefined,
		mileageLimit: undefined as number | undefined,
		excessMileageFee: undefined as number | undefined
	});

	// Form validation
	let errors = $state<VehicleFormErrors & FinancingFormErrors>({});

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

			// Fetch financing data separately
			const financingResponse = await fetch(`/api/financing/vehicles/${vehicleId}/financing`, {
				credentials: 'include'
			});

			if (financingResponse.ok) {
				const financingResult = await financingResponse.json();
				if (financingResult.data && vehicle) {
					// Attach financing to vehicle object for populateForm
					vehicle.financing = financingResult.data;
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
			vehicleType: vehicle.vehicleType,
			licensePlate: vehicle.licensePlate || '',
			nickname: vehicle.nickname || '',
			initialMileage: vehicle.initialMileage,
			purchasePrice: vehicle.purchasePrice,
			purchaseDate: vehicle.purchaseDate
				? new Date(vehicle.purchaseDate).toISOString().split('T')[0]
				: ''
		};

		if (vehicle.financing?.isActive) {
			showFinancingForm = true;
			financingForm = {
				financingType: vehicle.financing.financingType,
				provider: vehicle.financing.provider,
				originalAmount: vehicle.financing.originalAmount,
				apr: vehicle.financing.apr || 0,
				termMonths: vehicle.financing.termMonths,
				startDate: new Date(vehicle.financing.startDate).toISOString().split('T')[0]!,
				paymentAmount: vehicle.financing.paymentAmount,
				frequency: vehicle.financing.paymentFrequency,
				dayOfMonth: vehicle.financing.paymentDayOfMonth || 1,
				residualValue: vehicle.financing.residualValue,
				mileageLimit: vehicle.financing.mileageLimit,
				excessMileageFee: vehicle.financing.excessMileageFee
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

	function validateFinancingForm(): boolean {
		if (!showFinancingForm) return true;

		if (!financingForm.provider.trim()) {
			errors['provider'] = 'Provider is required';
		}

		if (financingForm.originalAmount <= 0) {
			errors['originalAmount'] = 'Amount must be greater than 0';
		}

		if (financingForm.financingType === 'loan') {
			if (financingForm.apr < 0 || financingForm.apr > 50) {
				errors['apr'] = 'APR must be between 0% and 50%';
			}
		}

		if (financingForm.termMonths < 1 || financingForm.termMonths > 600) {
			errors['termMonths'] = 'Term must be between 1 and 600 months';
		}

		if (!financingForm.startDate) {
			errors['startDate'] = 'Start date is required';
		}

		if (financingForm.paymentAmount <= 0) {
			errors['paymentAmount'] = 'Payment amount must be greater than 0';
		}

		return Object.keys(errors).length === 0;
	}

	function calculateAmortization() {
		if (
			!showFinancingForm ||
			financingForm.financingType !== 'loan' ||
			financingForm.originalAmount <= 0 ||
			financingForm.apr <= 0 ||
			financingForm.termMonths <= 0
		) {
			amortizationPreview = null;
			return;
		}

		const principal = financingForm.originalAmount;
		const monthlyRate = financingForm.apr / 100 / 12;
		const numPayments = financingForm.termMonths;

		const monthlyPayment =
			(principal * (monthlyRate * Math.pow(1 + monthlyRate, numPayments))) /
			(Math.pow(1 + monthlyRate, numPayments) - 1);

		const totalPayments = monthlyPayment * numPayments;
		const totalInterest = totalPayments - principal;

		const startDate = new Date(financingForm.startDate || new Date());
		const payoffDate = new Date(startDate);
		payoffDate.setMonth(payoffDate.getMonth() + numPayments);

		amortizationPreview = {
			monthlyPayment: Math.round(monthlyPayment * 100) / 100,
			totalInterest: Math.round(totalInterest * 100) / 100,
			totalPayments: Math.round(totalPayments * 100) / 100,
			payoffDate
		};
	}

	// Recalculate when financing parameters change
	$effect(() => {
		const amount = financingForm.originalAmount;
		const apr = financingForm.apr;
		const term = financingForm.termMonths;
		const show = showFinancingForm;
		const type = financingForm.financingType;

		void financingForm.startDate;

		if (show && type === 'loan' && amount > 0 && apr >= 0 && term > 0) {
			calculateAmortization();
		} else {
			amortizationPreview = null;
		}
	});

	// Sync payment amount from amortization preview
	$effect(() => {
		if (amortizationPreview && financingForm.financingType === 'loan') {
			financingForm.paymentAmount = amortizationPreview.monthlyPayment;
		}
	});

	async function handleSubmit(event: Event) {
		event.preventDefault();
		if (!validateVehicleForm() || !validateFinancingForm()) {
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

			// Handle financing data separately if provided
			if (showFinancingForm && financingForm.provider.trim() && financingForm.startDate) {
				const financingData: any = {
					financingType: financingForm.financingType,
					provider: financingForm.provider,
					originalAmount: Number(financingForm.originalAmount),
					termMonths: Number(financingForm.termMonths),
					startDate: new Date(financingForm.startDate).toISOString(),
					paymentAmount: Number(financingForm.paymentAmount),
					paymentFrequency: financingForm.frequency,
					paymentDayOfMonth: Number(financingForm.dayOfMonth)
				};

				// Add APR for loans
				if (financingForm.financingType === 'loan') {
					financingData.apr = Number(financingForm.apr);
				}

				// Add lease-specific fields
				if (financingForm.financingType === 'lease') {
					if (financingForm.residualValue !== undefined) {
						financingData.residualValue = Number(financingForm.residualValue);
					}
					if (financingForm.mileageLimit !== undefined) {
						financingData.mileageLimit = Number(financingForm.mileageLimit);
					}
					if (financingForm.excessMileageFee !== undefined) {
						financingData.excessMileageFee = Number(financingForm.excessMileageFee);
					}
				}

				console.log('Submitting financing data:', financingData);

				const financingResponse = await fetch(
					`/api/financing/vehicles/${finalVehicleId}/financing`,
					{
						method: 'POST',
						headers: {
							'Content-Type': 'application/json'
						},
						credentials: 'include',
						body: JSON.stringify(financingData)
					}
				);

				if (!financingResponse.ok) {
					const errorData = await financingResponse.json();
					console.error('Financing submission error:', errorData);
					appStore.addNotification({
						type: 'warning',
						message: `Vehicle saved but financing failed: ${errorData.message || 'Unknown error'}`
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

			<!-- Financing Information -->
			<div class="card">
				<div class="flex items-center justify-between mb-6">
					<div class="flex items-center gap-2">
						<DollarSign class="h-5 w-5 text-primary-600" />
						<h2 class="text-lg font-semibold text-gray-900">Financing Information</h2>
					</div>
					<div class="flex items-center gap-2">
						<Switch bind:checked={showFinancingForm} id="financing-toggle" />
						<Label for="financing-toggle" class="text-sm text-gray-700 cursor-pointer"
							>This vehicle has financing</Label
						>
					</div>
				</div>

				{#if showFinancingForm}
					<div class="space-y-6">
						<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
							<div class="space-y-2">
								<Label for="financingType">Financing Type *</Label>
								<Select.Root
									type="single"
									value={financingForm.financingType}
									onValueChange={v => {
										if (v) {
											financingForm.financingType = v as 'loan' | 'lease' | 'own';
										}
									}}
								>
									<Select.Trigger id="financingType" class="w-full">
										{financingForm.financingType === 'loan'
											? 'Loan'
											: financingForm.financingType === 'lease'
												? 'Lease'
												: 'Owned'}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="loan" label="Loan">Loan</Select.Item>
										<Select.Item value="lease" label="Lease">Lease</Select.Item>
										<Select.Item value="own" label="Owned">Owned</Select.Item>
									</Select.Content>
								</Select.Root>
							</div>

							<div class="space-y-2">
								<Label for="provider">
									{financingForm.financingType === 'loan'
										? 'Lender'
										: financingForm.financingType === 'lease'
											? 'Leasing Company'
											: 'Dealer/Seller'} *
								</Label>
								<Input
									id="provider"
									type="text"
									placeholder="e.g., Chase Bank, Toyota Financial"
									bind:value={financingForm.provider}
									aria-invalid={!!errors['provider']}
									aria-describedby={errors['provider'] ? 'provider-error' : undefined}
									required
								/>
								{#if errors['provider']}
									<FormFieldError id="provider-error">{errors['provider']}</FormFieldError>
								{/if}
							</div>

							<div class="space-y-2">
								<Label for="originalAmount">
									{isEditMode ? 'Original ' : ''}{financingForm.financingType === 'lease'
										? 'Lease'
										: financingForm.financingType === 'loan'
											? 'Loan'
											: 'Purchase'} Amount *
								</Label>
								<Input
									id="originalAmount"
									type="number"
									min="0"
									step="0.01"
									placeholder="0.00"
									bind:value={financingForm.originalAmount}
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

							{#if financingForm.financingType === 'loan'}
								<div class="space-y-2">
									<Label for="apr">APR (%) *</Label>
									<Input
										id="apr"
										type="number"
										min="0"
										max="50"
										step="0.01"
										placeholder="e.g., 4.5"
										bind:value={financingForm.apr}
										aria-invalid={!!errors['apr']}
										aria-describedby={errors['apr'] ? 'apr-error' : undefined}
										required
									/>
									{#if errors['apr']}
										<FormFieldError id="apr-error">{errors['apr']}</FormFieldError>
									{/if}
								</div>
							{/if}

							<div class="space-y-2">
								<Label for="termMonths">Term (Months) *</Label>
								<Select.Root
									type="single"
									value={String(financingForm.termMonths)}
									onValueChange={v => {
										if (v) {
											financingForm.termMonths = Number(v);
										}
									}}
								>
									<Select.Trigger
										id="termMonths"
										class="w-full"
										aria-invalid={!!errors['termMonths']}
										aria-describedby={errors['termMonths'] ? 'termMonths-error' : undefined}
									>
										{financingForm.termMonths} months ({Math.floor(financingForm.termMonths / 12)} years)
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="24" label="24 months (2 years)"
											>24 months (2 years)</Select.Item
										>
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
								<Label for="startDate">Start Date *</Label>
								<DatePicker
									id="startDate"
									bind:value={financingForm.startDate}
									placeholder="Select start date"
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
									value={String(financingForm.dayOfMonth)}
									onValueChange={v => {
										if (v) {
											financingForm.dayOfMonth = Number(v);
										}
									}}
								>
									<Select.Trigger
										id="dayOfMonth"
										class="w-full"
										aria-invalid={!!errors['dayOfMonth']}
										aria-describedby={errors['dayOfMonth'] ? 'dayOfMonth-error' : undefined}
									>
										{financingForm.dayOfMonth}
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

							{#if financingForm.financingType === 'lease'}
								<div class="space-y-2">
									<Label for="residualValue">Residual Value (Buyout Price)</Label>
									<Input
										id="residualValue"
										type="number"
										min="0"
										step="0.01"
										placeholder="0.00"
										bind:value={financingForm.residualValue}
									/>
								</div>

								<div class="space-y-2">
									<Label for="mileageLimit">Annual Mileage Limit</Label>
									<Input
										id="mileageLimit"
										type="number"
										min="0"
										placeholder="e.g., 12000"
										bind:value={financingForm.mileageLimit}
									/>
								</div>

								<div class="space-y-2">
									<Label for="excessMileageFee">Excess Mileage Fee (per mile)</Label>
									<Input
										id="excessMileageFee"
										type="number"
										min="0"
										step="0.01"
										placeholder="e.g., 0.25"
										bind:value={financingForm.excessMileageFee}
									/>
								</div>
							{/if}
						</div>

						<!-- Current Balance Display (Edit Mode Only) -->
						{#if isEditMode && vehicle?.financing?.currentBalance !== undefined}
							<div class="bg-gray-50 border border-gray-200 rounded-lg p-4">
								<h3 class="font-medium text-gray-900 mb-2">Current Status</h3>
								<div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
									<div>
										<p class="text-gray-600">Current Balance</p>
										<p class="font-semibold text-gray-900">
											{formatCurrency(vehicle.financing.currentBalance)}
										</p>
									</div>
									<div>
										<p class="text-gray-600">Original Amount</p>
										<p class="font-semibold text-gray-900">
											{formatCurrency(vehicle.financing.originalAmount)}
										</p>
									</div>
									<div>
										<p class="text-gray-600">Amount Paid</p>
										<p class="font-semibold text-gray-900">
											{formatCurrency(
												vehicle.financing.originalAmount - vehicle.financing.currentBalance
											)}
										</p>
									</div>
								</div>
							</div>
						{/if}

						<!-- Amortization Preview (Loans Only) -->
						{#if amortizationPreview && financingForm.financingType === 'loan'}
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
						Check the box above to {isEditMode ? 'add or edit' : 'add'} financing information for this
						vehicle
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
