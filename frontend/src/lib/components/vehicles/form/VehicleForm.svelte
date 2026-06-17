<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { routes, paramRoutes } from '$lib/routes';
	import { appStore } from '$lib/stores/app.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import {
		ArrowLeft,
		Car,
		Trash2,
		X,
		Check,
		LoaderCircle,
		Fuel,
		Zap,
		ChevronsUpDown,
		Ruler
	} from '@lucide/svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import DatePicker from '$lib/components/common/date-picker.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import { Switch } from '$lib/components/ui/switch';
	import * as Select from '$lib/components/ui/select';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { FormFieldError } from '$lib/components/ui/form-field';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
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
	import FinancingFormSection from './FinancingFormSection.svelte';
	import { vehicleApi } from '$lib/services/vehicle-api';
	import { getLongFormLabel } from '$lib/utils/units';
	import { dateOnlyToISO, toDateInputValue } from '$lib/utils/formatters';
	import type {
		Vehicle,
		VehicleFinancing,
		VehicleType,
		VehicleFormData,
		FinancingPaymentConfig,
		VehicleFormErrors,
		FinancingFormErrors,
		DistanceUnit,
		VolumeUnit,
		ChargeUnit
	} from '$lib/types';
	import { validateVehicleFields, validateFinancingFields } from './vehicle-form-validation';
	import { calculatePayoffDateFromStart } from '$lib/utils/financing-calculations';
	import FormLayout from '$lib/components/common/form-layout.svelte';

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
	let vehicle = $state<Vehicle | null>(null);

	// Energy tracking flags
	let trackFuel = $state(true);
	let trackCharging = $state(false);

	// Unit preferences — default from global settings on create, vehicle values on edit
	let unitPrefsOpen = $state(false);
	let distanceUnit = $state<DistanceUnit>(settingsStore.unitPreferences.distanceUnit);
	let volumeUnit = $state<VolumeUnit>(settingsStore.unitPreferences.volumeUnit);
	let chargeUnit = $state<ChargeUnit>(settingsStore.unitPreferences.chargeUnit);
	// True once the user picks a unit OR edit-mode loads the vehicle's saved units, so
	// the create-mode seeding effect below stops overriding their choice.
	let unitsTouched = $state(false);

	// Create mode: the $state initializers above run ONCE at mount, but the global
	// settings store hydrates ASYNC in the root layout — so on a cold/direct load of
	// /vehicles/new the initializers capture the USD/imperial DEFAULT, and a metric
	// user would get "Miles · Gallons" pre-selected (and silently saved). Re-seed from
	// the store once it resolves, but only while the user hasn't touched the units and
	// only in create mode (edit mode populates from the vehicle, not global prefs). (cycle 204)
	$effect(() => {
		if (isEditMode || unitsTouched) return;
		const prefs = settingsStore.unitPreferences;
		distanceUnit = prefs.distanceUnit;
		volumeUnit = prefs.volumeUnit;
		chargeUnit = prefs.chargeUnit;
	});

	let distanceLabel = $derived(getLongFormLabel(distanceUnit));
	let volumeLabel = $derived(getLongFormLabel(volumeUnit));
	let chargeLabel = $derived(getLongFormLabel(chargeUnit));

	// Form data
	let vehicleForm = $state<VehicleFormData>({
		make: '',
		model: '',
		year: new Date().getFullYear(),
		vehicleType: 'gas',
		licensePlate: '',
		nickname: '',
		vin: '',
		initialMileage: undefined,
		purchasePrice: undefined,
		purchaseDate: ''
	});

	function handleVehicleTypeChange(newType: string) {
		vehicleForm.vehicleType = newType as VehicleType;
		// Auto-set tracking defaults based on vehicle type
		if (newType === 'gas') {
			trackFuel = true;
			trackCharging = false;
		} else if (newType === 'electric') {
			trackFuel = false;
			trackCharging = true;
		} else if (newType === 'hybrid') {
			trackFuel = true;
			trackCharging = true;
		}
	}

	let ownershipType = $state<'own' | 'lease' | 'finance'>('own');

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
			vehicle = await vehicleApi.getVehicle(vehicleId!);

			// Fetch financing data separately
			try {
				const financingData = await vehicleApi.getFinancing(vehicleId!);
				if (financingData && vehicle) {
					vehicle.financing = financingData;
				}
			} catch {
				// Financing may not exist — that's fine
			}

			populateForm();
		} catch {
			appStore.addNotification({
				type: 'error',
				message: 'Error loading vehicle'
			});
			goto(resolve(routes.dashboard));
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
			vin: vehicle.vin || '',
			initialMileage: vehicle.initialMileage,
			purchasePrice: vehicle.purchasePrice,
			purchaseDate: vehicle.purchaseDate ? toDateInputValue(vehicle.purchaseDate) : ''
		};

		// Set tracking flags from vehicle data
		trackFuel = vehicle.trackFuel;
		trackCharging = vehicle.trackCharging;

		// Set unit preferences from vehicle data (edit mode). Mark touched so the
		// create-mode seeding effect never overrides the vehicle's own saved units.
		if (vehicle.unitPreferences) {
			distanceUnit = vehicle.unitPreferences.distanceUnit;
			volumeUnit = vehicle.unitPreferences.volumeUnit;
			chargeUnit = vehicle.unitPreferences.chargeUnit;
			unitsTouched = true;
		}

		if (vehicle.financing?.isActive) {
			// Set ownership type based on financing type
			if (vehicle.financing.financingType === 'loan') {
				ownershipType = 'finance';
			} else if (vehicle.financing.financingType === 'lease') {
				ownershipType = 'lease';
			} else {
				ownershipType = 'own';
			}

			financingForm = {
				financingType: vehicle.financing.financingType,
				provider: vehicle.financing.provider,
				originalAmount: vehicle.financing.originalAmount,
				apr: vehicle.financing.apr || 0,
				termMonths: vehicle.financing.termMonths,
				startDate: toDateInputValue(vehicle.financing.startDate),
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
		errors = validateVehicleFields(vehicleForm);
		return Object.keys(errors).length === 0;
	}

	function validateFinancingForm(): boolean {
		if (ownershipType === 'own') return true;
		const financingErrors = validateFinancingFields(financingForm, ownershipType);
		errors = { ...errors, ...financingErrors };
		return Object.keys(financingErrors).length === 0;
	}

	function calculateAmortization() {
		if (
			ownershipType !== 'finance' ||
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

		const payoffDate = calculatePayoffDateFromStart(financingForm.startDate, numPayments);

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
		const ownership = ownershipType;
		const type = financingForm.financingType;

		void financingForm.startDate;

		if (ownership === 'finance' && type === 'loan' && amount > 0 && apr >= 0 && term > 0) {
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

	// Update financingType when ownershipType changes
	$effect(() => {
		if (ownershipType === 'finance') {
			financingForm.financingType = 'loan';
		} else if (ownershipType === 'lease') {
			financingForm.financingType = 'lease';
		} else {
			financingForm.financingType = 'own';
		}
	});

	// Real-time VIN validation
	$effect(() => {
		if (errors['vin'] && vehicleForm.vin) {
			const vinRegex = /^[A-Z0-9]+$/i;
			if (
				vinRegex.test(vehicleForm.vin) &&
				vehicleForm.vin.length >= 11 &&
				vehicleForm.vin.length <= 17
			) {
				delete errors['vin'];
			}
		}
	});

	async function handleSubmit(event: Event) {
		event.preventDefault();
		if (!validateVehicleForm() || !validateFinancingForm()) {
			return;
		}

		isSubmitting = true;

		try {
			// Always-present (required) fields, shared by create and update.
			const base = {
				make: vehicleForm.make,
				model: vehicleForm.model,
				year: vehicleForm.year,
				vehicleType: vehicleForm.vehicleType,
				trackFuel,
				trackCharging,
				unitPreferences: {
					distanceUnit,
					volumeUnit,
					chargeUnit
				}
			};
			// Raw optional values ('' / undefined when the field is empty).
			const plate = vehicleForm.licensePlate || undefined;
			const nick = vehicleForm.nickname || undefined;
			const vinVal = vehicleForm.vin ? vehicleForm.vin.toUpperCase() : undefined;
			const mileage = vehicleForm.initialMileage ?? undefined;
			const price = vehicleForm.purchasePrice ?? undefined;
			const pDate = vehicleForm.purchaseDate
				? dateOnlyToISO(vehicleForm.purchaseDate)
				: undefined;

			// Update/create vehicle.
			let savedVehicle: Vehicle;
			if (isEditMode) {
				// On EDIT, an emptied optional field must be sent as null so the
				// column is actually CLEARED — JSON.stringify drops undefined, so
				// omitting it would leave the old value intact (silent data loss).
				savedVehicle = await vehicleApi.updateVehicle(vehicleId!, {
					...base,
					licensePlate: plate ?? null,
					nickname: nick ?? null,
					vin: vinVal ?? null,
					initialMileage: mileage ?? null,
					purchasePrice: price ?? null,
					purchaseDate: pDate ?? null
				});
			} else {
				// On CREATE there's nothing to clear → omit empty optionals.
				savedVehicle = await vehicleApi.createVehicle({
					...base,
					licensePlate: plate,
					nickname: nick,
					vin: vinVal,
					initialMileage: mileage,
					purchasePrice: price,
					purchaseDate: pDate
				});
			}

			const finalVehicleId = isEditMode ? vehicleId! : savedVehicle.id;

			// Handle financing data separately if provided
			if (ownershipType !== 'own' && financingForm.provider.trim() && financingForm.startDate) {
				const financingData: Partial<
					Omit<VehicleFinancing, 'id' | 'vehicleId' | 'createdAt' | 'updatedAt'>
				> = {
					financingType: financingForm.financingType,
					provider: financingForm.provider,
					originalAmount: Number(financingForm.originalAmount),
					termMonths: Number(financingForm.termMonths),
					startDate: dateOnlyToISO(financingForm.startDate),
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

				try {
					await vehicleApi.createFinancing(finalVehicleId, financingData);
				} catch (financingError) {
					const message =
						financingError instanceof Error ? financingError.message : 'Unknown error';
					appStore.addNotification({
						type: 'warning',
						message: `Vehicle saved but financing failed: ${message}`
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
				// Invalidate all data to force reload on the vehicle detail page
				await invalidateAll();
				goto(resolve(paramRoutes.vehicle, { id: vehicleId! }));
			} else {
				appStore.addVehicle(savedVehicle);
				appStore.addNotification({
					type: 'success',
					message: 'Vehicle added successfully!'
				});
				goto(resolve(routes.dashboard));
			}
		} catch (error) {
			if (import.meta.env.DEV) console.error('Error submitting vehicle:', error);
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
			await vehicleApi.deleteVehicle(vehicleId!);

			appStore.removeVehicle(vehicleId!);
			appStore.addNotification({
				type: 'success',
				message: 'Vehicle deleted successfully'
			});
			goto(resolve(routes.dashboard));
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Failed to delete vehicle';
			appStore.addNotification({
				type: 'error',
				message
			});
		} finally {
			isDeleting = false;
			showDeleteConfirm = false;
		}
	}

	function handleBack() {
		if (isEditMode) {
			goto(resolve(paramRoutes.vehicle, { id: vehicleId! }));
		} else {
			goto(resolve(routes.dashboard));
		}
	}
</script>

<FormLayout>
	{#if isLoading}
		<div class="flex items-center justify-center py-12">
			<LoaderCircle class="h-8 w-8 animate-spin text-primary" />
		</div>
	{:else}
		<div class="space-y-6">
			<!-- Header -->
			<div class="flex items-center gap-4">
				<Button variant="outline" size="icon" aria-label="Go back" onclick={handleBack}>
					<ArrowLeft class="h-4 w-4" />
				</Button>
				<div>
					<h1 class="text-3xl font-bold tracking-tight">
						{isEditMode ? 'Edit Vehicle' : 'Add New Vehicle'}
					</h1>
					{#if isEditMode && vehicleForm.make && vehicleForm.model}
						<p class="text-muted-foreground mt-1">
							{vehicleForm.nickname ||
								`${vehicleForm.year} ${vehicleForm.make} ${vehicleForm.model}`}
						</p>
					{:else if !isEditMode}
						<p class="text-muted-foreground mt-1">
							Enter your vehicle information and optional financing details
						</p>
					{/if}
				</div>
			</div>

			<form onsubmit={handleSubmit} class="space-y-6 pb-32 sm:pb-24">
				<!-- Vehicle Information -->
				<Card>
					<CardHeader>
						<div class="flex items-center gap-2">
							<Car class="h-5 w-5 text-primary" />
							<CardTitle>Vehicle Information</CardTitle>
						</div>
						<CardDescription>Basic details about your vehicle</CardDescription>
					</CardHeader>
					<CardContent>
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
								<Label for="vin">VIN (Vehicle Identification Number)</Label>
								<Input
									id="vin"
									type="text"
									placeholder="e.g., 1HGBH41JXMN109186"
									bind:value={vehicleForm.vin}
									aria-invalid={!!errors['vin']}
									aria-describedby={errors['vin'] ? 'vin-error' : undefined}
								/>
								{#if errors['vin']}
									<FormFieldError id="vin-error">{errors['vin']}</FormFieldError>
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
									<FormFieldError id="initialMileage-error"
										>{errors['initialMileage']}</FormFieldError
									>
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
									<FormFieldError id="purchasePrice-error">{errors['purchasePrice']}</FormFieldError
									>
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

							<div class="space-y-2">
								<Label for="vehicleType">Vehicle Type</Label>
								<Select.Root
									type="single"
									value={vehicleForm.vehicleType}
									onValueChange={handleVehicleTypeChange}
								>
									<Select.Trigger id="vehicleType" class="w-full">
										{vehicleForm.vehicleType === 'gas'
											? 'Gas'
											: vehicleForm.vehicleType === 'electric'
												? 'Electric'
												: 'Hybrid'}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="gas" label="Gas">Gas</Select.Item>
										<Select.Item value="electric" label="Electric">Electric</Select.Item>
										<Select.Item value="hybrid" label="Hybrid">Hybrid</Select.Item>
									</Select.Content>
								</Select.Root>
							</div>
						</div>

						<!-- Energy Tracking Preferences -->
						<div class="mt-6 space-y-2">
							<Label class="text-sm font-medium text-foreground">Energy Tracking</Label>
							<div class="flex items-center gap-4">
								<label for="trackFuel" class="flex items-center gap-1.5 cursor-pointer">
									<Switch id="trackFuel" bind:checked={trackFuel} />
									<Fuel class="h-3.5 w-3.5 text-muted-foreground" />
									<span class="text-sm">Fuel</span>
								</label>
								<label for="trackCharging" class="flex items-center gap-1.5 cursor-pointer">
									<Switch id="trackCharging" bind:checked={trackCharging} />
									<Zap class="h-3.5 w-3.5 text-muted-foreground" />
									<span class="text-sm">Charging</span>
								</label>
							</div>
						</div>
					</CardContent>
				</Card>

				<!-- Unit Preferences -->
				<Card>
					<Collapsible.Root bind:open={unitPrefsOpen}>
						<CardHeader>
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-2">
									<Ruler class="h-5 w-5 text-primary" />
									<div>
										<CardTitle>Unit Preferences</CardTitle>
										<CardDescription>
											Distance, volume, and charge units for this vehicle
										</CardDescription>
									</div>
								</div>
								<Collapsible.Trigger
									class="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-muted-foreground h-9 w-9"
								>
									<ChevronsUpDown class="h-4 w-4" />
									<span class="sr-only">Toggle unit preferences</span>
								</Collapsible.Trigger>
							</div>
							{#if !unitPrefsOpen}
								<p class="text-sm text-muted-foreground">
									{distanceLabel} · {volumeLabel} · {chargeLabel}
								</p>
							{/if}
						</CardHeader>
						<Collapsible.Content>
							<CardContent class="space-y-6">
								<div class="space-y-2">
									<Label for="distanceUnit">Distance Unit</Label>
									<Select.Root
										type="single"
										value={distanceUnit}
										onValueChange={v => {
											if (v) {
												distanceUnit = v as DistanceUnit;
												unitsTouched = true;
											}
										}}
									>
										<Select.Trigger id="distanceUnit" class="w-full">
											{distanceLabel}
										</Select.Trigger>
										<Select.Content>
											<Select.Item value="miles" label="Miles">Miles</Select.Item>
											<Select.Item value="kilometers" label="Kilometers">Kilometers</Select.Item>
										</Select.Content>
									</Select.Root>
								</div>

								<div class="space-y-2">
									<Label for="volumeUnit">Fuel Volume Unit</Label>
									<Select.Root
										type="single"
										value={volumeUnit}
										onValueChange={v => {
											if (v) {
												volumeUnit = v as VolumeUnit;
												unitsTouched = true;
											}
										}}
									>
										<Select.Trigger id="volumeUnit" class="w-full">
											{volumeLabel}
										</Select.Trigger>
										<Select.Content>
											<Select.Item value="gallons_us" label="Gallons (US)">Gallons (US)</Select.Item
											>
											<Select.Item value="gallons_uk" label="Gallons (UK)">Gallons (UK)</Select.Item
											>
											<Select.Item value="liters" label="Liters">Liters</Select.Item>
										</Select.Content>
									</Select.Root>
								</div>

								<div class="space-y-2">
									<Label for="chargeUnit">Electric Charge Unit</Label>
									<Select.Root
										type="single"
										value={chargeUnit}
										onValueChange={v => {
											if (v) {
												chargeUnit = v as ChargeUnit;
												unitsTouched = true;
											}
										}}
									>
										<Select.Trigger id="chargeUnit" class="w-full">
											{chargeLabel}
										</Select.Trigger>
										<Select.Content>
											<Select.Item value="kwh" label="kWh">kWh</Select.Item>
										</Select.Content>
									</Select.Root>
								</div>
							</CardContent>
						</Collapsible.Content>
					</Collapsible.Root>
				</Card>

				<!-- Financing Information -->
				<FinancingFormSection
					bind:ownershipType
					bind:financingForm
					{errors}
					{isEditMode}
					{vehicle}
					{amortizationPreview}
				/>
			</form>

			<!-- Floating Action Bar -->
			<div class="fixed bottom-4 left-4 right-4 z-50 sm:bottom-8 sm:right-8 sm:left-auto sm:w-auto">
				<div
					class="flex flex-row gap-3 sm:gap-4 justify-center sm:justify-end items-center bg-background sm:bg-transparent p-3 sm:p-0 rounded-full sm:rounded-none shadow-2xl sm:shadow-none border sm:border-0"
				>
					{#if isEditMode}
						<Button
							type="button"
							variant="destructive"
							size="lg"
							onclick={confirmDelete}
							disabled={isDeleting || isSubmitting}
							class="rounded-full shadow-lg transition-all duration-300 sm:hover:scale-105 h-14 px-5 flex-shrink-0"
						>
							<Trash2 class="h-5 w-5 sm:mr-2" />
							<span class="hidden sm:inline font-semibold">Delete</span>
						</Button>
					{/if}

					<Button
						type="button"
						variant="outline"
						size="lg"
						onclick={handleBack}
						disabled={isSubmitting || isDeleting}
						class="rounded-full shadow-lg transition-all duration-300 sm:hover:scale-105 h-14 px-5 flex-shrink-0"
					>
						<X class="h-5 w-5 sm:mr-2" />
						<span class="hidden sm:inline font-semibold">Cancel</span>
					</Button>

					<Button
						type="button"
						size="lg"
						onclick={handleSubmit}
						disabled={isSubmitting || isDeleting}
						class="rounded-full group shadow-2xl transition-all duration-300 sm:hover:scale-110 h-14 px-6 flex-1 sm:flex-initial"
					>
						{#if isSubmitting}
							<LoaderCircle class="h-5 w-5 animate-spin mr-2" />
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
						Are you sure you want to delete this vehicle? This permanently deletes the vehicle and
						everything attached to it — all expenses, fuel and charging history, odometer readings,
						financing details, and uploaded photos. This action cannot be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>

				{#if vehicle}
					<Card class="bg-muted/50">
						<CardContent class="p-4">
							<div class="flex items-center gap-3">
								<div class="p-2 rounded-lg bg-destructive/10 text-destructive">
									<Car class="h-4 w-4" />
								</div>
								<div>
									<p class="font-medium">
										{vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}`}
									</p>
									<p class="text-sm text-muted-foreground">
										{vehicle.year}
										{vehicle.make}
										{vehicle.model}
									</p>
								</div>
							</div>
						</CardContent>
					</Card>
				{/if}

				<AlertDialogFooter>
					<AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onclick={handleDelete}
						disabled={isDeleting}
						class="bg-destructive hover:bg-destructive/90"
					>
						{#if isDeleting}
							<LoaderCircle class="h-4 w-4 animate-spin mr-2" />
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
</FormLayout>
