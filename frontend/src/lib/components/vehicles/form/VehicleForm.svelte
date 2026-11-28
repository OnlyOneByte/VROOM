<script lang="ts">
	import { focusFirstProblem } from '#lib/utils/focus.ts';
	import { onMount, untrack } from 'svelte';
	import { goto, refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { routes, paramRoutes } from '#lib/routes.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { trackPendingSave } from '#lib/utils/pending-saves.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import {
		ArrowLeft,
		Car,
		Trash2,
		LoaderCircle,
		Fuel,
		Zap,
		Leaf,
		CircleAlert
	} from '@lucide/svelte';
	import Button from '#lib/components/ui/button/button.svelte';
	import DatePicker from '#lib/components/common/date-picker.svelte';
	import Input from '#lib/components/ui/input/input.svelte';
	import MoneyInput from '#lib/components/common/MoneyInput.svelte';
	import Label from '#lib/components/ui/label/label.svelte';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import * as Collapsible from '#lib/components/ui/collapsible/index.ts';
	import { FormFieldDescription, FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import { Card, CardContent } from '#lib/components/ui/card/index.ts';
	import {
		AlertDialog,
		AlertDialogAction,
		AlertDialogCancel,
		AlertDialogContent,
		AlertDialogDescription,
		AlertDialogFooter,
		AlertDialogHeader,
		AlertDialogTitle
	} from '#lib/components/ui/alert-dialog/index.ts';
	import FinancingFormSection from './FinancingFormSection.svelte';
	import CatalogCombobox from './CatalogCombobox.svelte';
	import {
		loadVehicleCatalog,
		makeSuggestions,
		modelSuggestions,
		textStillNames,
		type VehicleCatalog
	} from '#lib/utils/vehicle-catalog.ts';
	import { vehicleApi } from '#lib/services/vehicle-api.ts';
	import { getDistanceUnitLabel, getLongFormLabel } from '#lib/utils/units.ts';
	import {
		dateOnlyToISO,
		formatNumber,
		fromMinor,
		toDateInputValue,
		toMinor
	} from '#lib/utils/formatters.ts';
	import type {
		Vehicle,
		VehicleFinancing,
		VehicleKind,
		VehicleType,
		VehicleFormData,
		FinancingPaymentConfig,
		VehicleFormErrors,
		FinancingFormErrors,
		DistanceUnit,
		VolumeUnit,
		ChargeUnit
	} from '#lib/types/index.ts';
	import { validateVehicleFields, validateFinancingFields } from './vehicle-form-validation';
	import { VEHICLE_KINDS } from '#lib/types/vehicle.ts';
	import { VEHICLE_KIND_LABELS } from '#lib/utils/vehicle-kind.ts';
	import { maxVehicleYear } from '#lib/constants/limits.ts';
	import {
		annuityPayment,
		calculatePayoffDateFromStart,
		resolveCurrentOdometer
	} from '#lib/utils/financing-calculations.ts';
	import FormLayout from '#lib/components/common/form-layout.svelte';
	import FormActionBar from '#lib/components/common/form-action-bar.svelte';
	import DemoSaveNote, { DEMO_SAVE_NOTE_ID } from '#lib/components/common/demo-save-note.svelte';
	import { authStore } from '#lib/stores/auth.svelte.ts';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';
	import { ApiError, userFacingErrorMessage } from '#lib/utils/error-handling.ts';

	interface Props {
		vehicleId?: string;
	}

	let { vehicleId }: Props = $props();

	const isEditMode = $derived(!!vehicleId);

	let isLoading = $state(untrack(() => !!vehicleId));
	let isSubmitting = $state(false);
	const demo = $derived(authStore.user?.demo === true);

	let isPayingOff = $state(false);

	onMount(() => trackPendingSave(() => isSubmitting || isPayingOff));
	let isDeleting = $state(false);
	let showDeleteConfirm = $state(false);
	let showPayoffConfirm = $state(false);
	let financingBeingEnded = $state<VehicleFinancing | null>(null);
	let showUnitChangeConfirm = $state(false);
	let vehicle = $state<Vehicle | null>(null);
	let todayReading = $state<number | null>(null);
	let loadError = $state<string | null>(null);

	let trackFuel = $state(true);
	let trackCharging = $state(false);

	let unitPrefsOpen = $state(false);
	let distanceUnit = $state<DistanceUnit>(settingsStore.unitPreferences.distanceUnit);
	let volumeUnit = $state<VolumeUnit>(settingsStore.unitPreferences.volumeUnit);
	let chargeUnit = $state<ChargeUnit>(settingsStore.unitPreferences.chargeUnit);
	let unitsTouched = $state(false);

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

	let unitChangeDescription = $derived.by(() => {
		const saved = vehicle?.unitPreferences;
		if (!saved) return '';
		const changes = [
			['distance', saved.distanceUnit, distanceUnit],
			['fuel volume', saved.volumeUnit, volumeUnit],
			['charge', saved.chargeUnit, chargeUnit]
		] as const;
		const changed = changes.filter(([, from, to]) => from !== to);
		const summary = changed
			.map(
				([name, from, to]) => `${name} from ${getLongFormLabel(from)} to ${getLongFormLabel(to)}`
			)
			.join(' and ');
		const [, fromUnit, toUnit] = changed[0] ?? [];
		const inSentence = (unit: DistanceUnit | VolumeUnit | ChargeUnit) => {
			const label = getLongFormLabel(unit);
			return label.charAt(0).toLowerCase() + label.slice(1);
		};
		const example =
			fromUnit && toUnit
				? ` For example, a saved 100 ${inSentence(fromUnit)} would read 100 ${inSentence(toUnit)}.`
				: '';
		return `You're changing ${summary}. Readings already saved for this vehicle, such as its initial mileage, odometer entries, trips and fill-ups, are not converted: each number stays the same and is shown in the new units.${example} Only change units if they were set wrong.`;
	});

	function needsUnitChangeConfirmation(error: unknown): boolean {
		return error instanceof ApiError && error.details?.['requiresUnitChangeConfirmation'] === true;
	}

	let vehicleForm = $state<VehicleFormData>({
		make: '',
		model: '',
		year: new Date().getFullYear(),
		vehicleType: 'gas',
		vehicleKind: 'car',
		licensePlate: '',
		nickname: '',
		vin: '',
		initialMileage: undefined,
		purchasePrice: undefined,
		purchaseDate: ''
	});

	let catalog = $state<VehicleCatalog | null>(null);
	let catalogModelId = $state<string | null>(null);
	let catalogAnchor = { make: '', model: '' };

	let makeOptions = $derived(catalog ? makeSuggestions(catalog, vehicleForm.make) : []);
	let modelOptions = $derived(
		catalog ? modelSuggestions(catalog, vehicleForm.make, vehicleForm.model) : []
	);

	function ensureCatalog() {
		if (catalog) return;
		loadVehicleCatalog()
			.then(loaded => (catalog = loaded))
			.catch(() => undefined);
	}

	function setCatalogModel(id: string | null) {
		catalogModelId = id;
		catalogAnchor = { make: vehicleForm.make, model: vehicleForm.model };
	}

	$effect(() => {
		const { make, model } = vehicleForm;
		if (!catalogModelId) return;
		if (make === catalogAnchor.make && model === catalogAnchor.model) return;
		if (!untrack(() => catalog && textStillNames(catalog, catalogModelId!, make, model))) {
			catalogModelId = null;
		}
	});

	let headerDescription = $derived(
		!isEditMode
			? 'You can change any of this later.'
			: vehicleForm.make && vehicleForm.model
				? vehicleForm.nickname || `${vehicleForm.year} ${vehicleForm.make} ${vehicleForm.model}`
				: undefined
	);

	function handleVehicleTypeChange(newType: string) {
		vehicleForm.vehicleType = newType as VehicleType;
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

	let errors = $state<VehicleFormErrors & FinancingFormErrors>({});

	let amortizationPreview = $state<{
		monthlyPayment: number;
		totalInterest: number;
		totalPayments: number;
		payoffDate: Date;
	} | null>(null);

	$effect(() => {
		if (isEditMode && vehicleId) {
			loadVehicle();
		}
	});

	async function loadTodayReading(id: string, initial: number | null) {
		try {
			const stats = await vehicleApi.getVehicleStats(id, '30d');
			todayReading = resolveCurrentOdometer(stats.currentOdometer, stats.currentMileage, initial);
		} catch {
			todayReading = null;
		}
	}

	async function loadVehicle() {
		isLoading = true;
		loadError = null;
		try {
			vehicle = await vehicleApi.getVehicle(vehicleId!);
			void loadTodayReading(vehicleId!, vehicle.initialMileage ?? null);

			const financingData = await vehicleApi.getFinancing(vehicleId!);
			if (financingData && vehicle) {
				vehicle.financing = financingData;
			}

			populateForm();
		} catch (error) {
			if (error instanceof ApiError && error.statusCode === 404) {
				appStore.addNotification({ type: 'error', message: 'That vehicle no longer exists.' });
				goto(resolve(routes.vehicles));
				return;
			}
			loadError = userFacingErrorMessage(error);
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
			vehicleType: vehicle.vehicleType,
			vehicleKind: vehicle.vehicleKind ?? 'car',
			licensePlate: vehicle.licensePlate || '',
			nickname: vehicle.nickname || '',
			vin: vehicle.vin || '',
			initialMileage: vehicle.initialMileage,
			purchasePrice: vehicle.purchasePrice,
			purchaseDate: vehicle.purchaseDate ? toDateInputValue(vehicle.purchaseDate) : ''
		};
		setCatalogModel(vehicle.catalogModelId ?? null);

		trackFuel = vehicle.trackFuel;
		trackCharging = vehicle.trackCharging;

		if (vehicle.unitPreferences) {
			distanceUnit = vehicle.unitPreferences.distanceUnit;
			volumeUnit = vehicle.unitPreferences.volumeUnit;
			chargeUnit = vehicle.unitPreferences.chargeUnit;
			unitsTouched = true;
		}

		if (vehicle.financing?.isActive) {
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
		const financingErrors = validateFinancingFields(
			{ ...financingForm, paymentAmount: paymentToSave },
			ownershipType
		);
		errors = { ...errors, ...financingErrors };
		return Object.keys(financingErrors).length === 0;
	}

	function calculateAmortization() {
		if (
			ownershipType !== 'finance' ||
			financingForm.financingType !== 'loan' ||
			financingForm.originalAmount <= 0 ||
			!Number.isFinite(financingForm.apr) ||
			financingForm.apr < 0 ||
			financingForm.termMonths <= 0
		) {
			amortizationPreview = null;
			return;
		}

		const principal = financingForm.originalAmount;
		const numPayments = financingForm.termMonths;
		const monthlyPayment = annuityPayment(principal, financingForm.apr, numPayments);

		const totalPayments = monthlyPayment * numPayments;
		const totalInterest = totalPayments - principal;

		const payoffDate = calculatePayoffDateFromStart(financingForm.startDate, numPayments);

		amortizationPreview = {
			monthlyPayment: fromMinor(toMinor(monthlyPayment)),
			totalInterest: fromMinor(toMinor(totalInterest)),
			totalPayments: fromMinor(toMinor(totalPayments)),
			payoffDate
		};
	}

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

	let loanTermsChanged = $derived.by(() => {
		const saved = vehicle?.financing;
		if (!isEditMode || !saved?.isActive) return true;
		return (
			saved.financingType !== financingForm.financingType ||
			saved.originalAmount !== Number(financingForm.originalAmount) ||
			(saved.apr ?? 0) !== Number(financingForm.apr) ||
			saved.termMonths !== Number(financingForm.termMonths)
		);
	});

	let activeFinancingToEnd = $derived(
		isEditMode && ownershipType === 'own' && vehicle?.financing?.isActive ? vehicle.financing : null
	);

	let payoffConfirmCopy = $derived.by(() => {
		const financing = financingBeingEnded;
		if (!financing) return { title: '', description: '', confirmLabel: '' };
		const lender = financing.provider ? ` with ${financing.provider}` : '';
		if (financing.financingType === 'lease') {
			return {
				title: 'End the lease?',
				description: `Switching to Own ends the lease${lender}. It will no longer show on the Finance tab. Lease payments you already logged stay in your expenses.`,
				confirmLabel: 'End lease'
			};
		}
		return {
			title: 'Mark the loan as paid off?',
			description: `Switching to Own marks the loan${lender} as paid off. It will no longer show on the Finance tab. Loan payments you already logged stay in your expenses.`,
			confirmLabel: 'Mark paid off'
		};
	});

	let paymentToSave = $derived(
		financingForm.financingType === 'loan' && amortizationPreview && loanTermsChanged
			? amortizationPreview.monthlyPayment
			: Number(financingForm.paymentAmount)
	);

	$effect(() => {
		if (ownershipType === 'finance') {
			financingForm.financingType = 'loan';
		} else if (ownershipType === 'lease') {
			financingForm.financingType = 'lease';
		} else {
			financingForm.financingType = 'own';
		}
	});

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

	let formEl = $state<HTMLFormElement | null>(null);

	async function handleSubmit(event: Event) {
		event.preventDefault();
		if (demo) return;
		if (!validateVehicleForm() || !validateFinancingForm()) {
			await focusFirstProblem(formEl);
			return;
		}
		if (activeFinancingToEnd) {
			financingBeingEnded = activeFinancingToEnd;
			showPayoffConfirm = true;
			return;
		}
		await saveVehicle();
	}

	async function payOffAndSave() {
		const financing = financingBeingEnded;
		if (!financing) return;
		isPayingOff = true;
		try {
			const ended = await vehicleApi.payOffFinancing(financing.id);
			if (vehicle) vehicle.financing = ended;
		} catch (error) {
			isPayingOff = false;
			appStore.addNotification({
				type: 'error',
				message: `Couldn't mark the ${financing.financingType === 'lease' ? 'lease as ended' : 'loan as paid off'}. ${userFacingErrorMessage(error)}`
			});
			throw error;
		}
		try {
			await saveVehicle();
		} finally {
			isPayingOff = false;
		}
	}

	async function saveVehicle(confirmUnitChange = false) {
		isSubmitting = true;

		try {
			const base = {
				make: vehicleForm.make,
				model: vehicleForm.model,
				year: vehicleForm.year,
				vehicleType: vehicleForm.vehicleType,
				vehicleKind: vehicleForm.vehicleKind,
				catalogModelId,
				trackFuel,
				trackCharging,
				unitPreferences: {
					distanceUnit,
					volumeUnit,
					chargeUnit
				}
			};
			const plate = vehicleForm.licensePlate || undefined;
			const nick = vehicleForm.nickname || undefined;
			const vinVal = vehicleForm.vin ? vehicleForm.vin.toUpperCase() : undefined;
			const mileage = vehicleForm.initialMileage ?? undefined;
			const price = vehicleForm.purchasePrice ?? undefined;
			const pDate = vehicleForm.purchaseDate ? dateOnlyToISO(vehicleForm.purchaseDate) : undefined;

			let savedVehicle: Vehicle;
			if (isEditMode) {
				// JSON drops undefined; send null to clear an emptied optional.
				savedVehicle = await vehicleApi.updateVehicle(vehicleId!, {
					...base,
					licensePlate: plate ?? null,
					nickname: nick ?? null,
					vin: vinVal ?? null,
					initialMileage: mileage ?? null,
					purchasePrice: price ?? null,
					purchaseDate: pDate ?? null,
					...(confirmUnitChange ? { confirmUnitChange: true } : {})
				});
			} else {
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

			if (ownershipType !== 'own' && financingForm.provider.trim() && financingForm.startDate) {
				const financingData: Partial<
					Omit<VehicleFinancing, 'id' | 'vehicleId' | 'createdAt' | 'updatedAt'>
				> = {
					financingType: financingForm.financingType,
					provider: financingForm.provider,
					originalAmount: Number(financingForm.originalAmount),
					termMonths: Number(financingForm.termMonths),
					startDate: dateOnlyToISO(financingForm.startDate),
					paymentAmount: paymentToSave,
					paymentFrequency: financingForm.frequency,
					paymentDayOfMonth: Number(financingForm.dayOfMonth)
				};

				if (financingForm.financingType === 'loan') {
					financingData.apr = Number(financingForm.apr);
				}

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
					appStore.addNotification({
						type: 'warning',
						message: `The vehicle was saved, but its financing couldn't be saved. ${userFacingErrorMessage(financingError)}`
					});
				}
			}

			if (isEditMode) {
				appStore.updateVehicle(vehicleId!, savedVehicle);
				appStore.addNotification({
					type: 'success',
					message: 'Vehicle updated successfully!'
				});
				await refreshAll();
				goto(resolve(paramRoutes.vehicle, { id: vehicleId! }));
			} else {
				appStore.addVehicle(savedVehicle);
				appStore.addNotification({
					type: 'success',
					message: 'Vehicle added successfully!'
				});
				// The first car goes back to the dashboard checklist, whose next step is the first fill-up.
				let ownedCount = 0;
				try {
					ownedCount = (await vehicleApi.getVehicles()).length;
				} catch {
					// The garage is still a fine place to land.
				}
				goto(resolve(ownedCount === 1 ? routes.dashboard : routes.vehicles));
			}
		} catch (error) {
			if (!confirmUnitChange && needsUnitChangeConfirmation(error)) {
				showUnitChangeConfirm = true;
				return;
			}
			if (import.meta.env.DEV) console.error('Error submitting vehicle:', error);
			appStore.addNotification({
				type: 'error',
				message: `Couldn't ${isEditMode ? 'update' : 'add'} the vehicle. ${userFacingErrorMessage(error)}`
			});
		} finally {
			isSubmitting = false;
		}
	}

	function confirmDelete() {
		showDeleteConfirm = true;
	}

	async function handleDelete() {
		if (demo) return;
		isDeleting = true;

		try {
			await vehicleApi.deleteVehicle(vehicleId!);

			appStore.removeVehicle(vehicleId!);
			appStore.addNotification({
				type: 'success',
				message: 'Vehicle deleted successfully'
			});
			goto(resolve(routes.vehicles));
		} catch (error) {
			appStore.addNotification({
				type: 'error',
				message: `Couldn't delete the vehicle. ${userFacingErrorMessage(error)}`
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
			goto(resolve(routes.vehicles));
		}
	}

	const POWERTRAINS = [
		{ value: 'gas', label: 'Gas', icon: Fuel },
		{ value: 'electric', label: 'Electric', icon: Zap },
		{ value: 'hybrid', label: 'Hybrid', icon: Leaf }
	] as const;
</script>

{#snippet header()}
	<PageHeader
		variant="display"
		title={isEditMode ? 'Edit vehicle' : 'Add a vehicle'}
		description={headerDescription}
	>
		{#snippet back()}
			<Button
				variant="outline"
				size="icon-lg"
				class="shrink-0 rounded-full"
				aria-label={isEditMode ? 'Back to the vehicle' : 'Back to garage'}
				onclick={handleBack}
			>
				<ArrowLeft class="size-5" />
			</Button>
		{/snippet}
	</PageHeader>
{/snippet}

{#snippet optional(text: string)}
	{text} <span class="font-normal text-muted-foreground">(optional)</span>
{/snippet}

<FormLayout>
	{#if isLoading}
		<div class="space-y-8">
			{@render header()}
			<div
				class="space-y-6"
				role="status"
				aria-label="Loading vehicle"
				data-testid="vehicle-form-loading"
			>
				<span class="sr-only">Loading vehicle</span>
				<div class="grid grid-cols-1 gap-x-5 gap-y-6 md:grid-cols-2">
					{#each Array(6) as _, i (i)}
						<div class="space-y-2">
							<Skeleton class="h-4 w-24" />
							<Skeleton class="h-11 w-full" />
						</div>
					{/each}
				</div>
			</div>
			<div
				class="flex justify-end gap-3"
				aria-hidden="true"
				data-testid="vehicle-form-loading-actions"
			>
				<Skeleton class="h-11 w-24 rounded-full" />
				<Skeleton class="h-11 w-32 rounded-full" />
			</div>
		</div>
	{:else if loadError}
		<div class="space-y-8">
			{@render header()}
			<div class="rounded-lg border bg-card p-6">
				<div class="mb-4 flex items-center gap-3 text-destructive">
					<CircleAlert class="h-5 w-5" />
					<p class="font-medium">Couldn't load this vehicle</p>
				</div>
				<p class="mb-4 text-sm text-muted-foreground">{loadError}</p>
				<Button size="lg" onclick={loadVehicle}>Retry</Button>
			</div>
		</div>
	{:else}
		<div class="space-y-8">
			{@render header()}

			<form bind:this={formEl} onsubmit={handleSubmit} class="space-y-8">
				<section aria-label="Vehicle details" class="space-y-6">
					<div class="grid grid-cols-1 gap-x-5 gap-y-6 md:grid-cols-2">
						<CatalogCombobox
							id="make"
							label="Make"
							placeholder="e.g., Toyota, Honda, Ford"
							bind:value={vehicleForm.make}
							suggestions={makeOptions}
							listLabel="Make suggestions"
							error={errors['make']}
							onFocus={ensureCatalog}
						/>

						<CatalogCombobox
							id="model"
							label="Model"
							placeholder="e.g., Camry, Civic, F-150"
							bind:value={vehicleForm.model}
							suggestions={modelOptions}
							listLabel="Model suggestions"
							error={errors['model']}
							onFocus={ensureCatalog}
							onPick={entry => setCatalogModel(entry.id)}
						/>

						<div class="space-y-2">
							<Label for="year">Year</Label>
							<Input
								id="year"
								type="number"
								min="1900"
								max={maxVehicleYear()}
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
							<Label for="vehicleKind">Kind</Label>
							<Select.Root
								type="single"
								value={vehicleForm.vehicleKind}
								onValueChange={kind => (vehicleForm.vehicleKind = kind as VehicleKind)}
							>
								<Select.Trigger id="vehicleKind" class="w-full">
									{VEHICLE_KIND_LABELS[vehicleForm.vehicleKind]}
								</Select.Trigger>
								<Select.Content>
									{#each VEHICLE_KINDS as kind (kind)}
										<Select.Item value={kind} label={VEHICLE_KIND_LABELS[kind]}>
											{VEHICLE_KIND_LABELS[kind]}
										</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>

						<div class="space-y-2">
							<Label for="nickname">{@render optional('Nickname')}</Label>
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
							<Label for="initialMileage">
								{isEditMode ? 'Starting odometer' : 'Odometer today'}
							</Label>
							<Input
								id="initialMileage"
								type="number"
								min="0"
								placeholder={isEditMode ? 'Reading when you started' : 'Current odometer reading'}
								bind:value={vehicleForm.initialMileage}
								aria-invalid={!!errors['initialMileage']}
								aria-describedby={errors['initialMileage']
									? 'initialMileage-error'
									: 'initialMileage-hint'}
							/>
							{#if errors['initialMileage']}
								<FormFieldError id="initialMileage-error">
									{errors['initialMileage']}
								</FormFieldError>
							{:else}
								<FormFieldDescription id="initialMileage-hint">
									{#if isEditMode}
										Cost per {distanceUnit === 'kilometers' ? 'km' : 'mile'} counts from this reading.
										{#if todayReading !== null && todayReading !== (vehicle?.initialMileage ?? null)}
											Today it reads {formatNumber(todayReading, 0)}
											{getDistanceUnitLabel(distanceUnit, true)}; log new readings on the Odometer
											tab.
										{/if}
									{:else}
										Used as the starting point for cost per {distanceUnit === 'kilometers'
											? 'km'
											: 'mile'}.
									{/if}
								</FormFieldDescription>
							{/if}
						</div>

						<div class="space-y-2">
							<Label for="licensePlate">{@render optional('Plate')}</Label>
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
							<Label for="vin">{@render optional('VIN')}</Label>
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
							<Label for="purchasePrice">{@render optional('Purchase price')}</Label>
							<MoneyInput
								id="purchasePrice"
								bind:value={vehicleForm.purchasePrice}
								aria-invalid={!!errors['purchasePrice']}
								aria-describedby={errors['purchasePrice'] ? 'purchasePrice-error' : undefined}
							/>
							{#if errors['purchasePrice']}
								<FormFieldError id="purchasePrice-error">
									{errors['purchasePrice']}
								</FormFieldError>
							{/if}
						</div>

						<div class="space-y-2">
							<Label for="purchaseDate">{@render optional('Purchase date')}</Label>
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

					<fieldset class="space-y-2">
						<legend class="mb-2 text-sm font-medium">Fuel</legend>
						<div class="flex flex-wrap gap-2">
							{#each POWERTRAINS as option (option.value)}
								<label
									class="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-border-strong bg-surface px-4 text-sm font-semibold transition-colors has-checked:border-foreground has-checked:bg-foreground has-checked:text-background has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50"
								>
									<input
										type="radio"
										name="vehicleType"
										class="sr-only"
										value={option.value}
										checked={vehicleForm.vehicleType === option.value}
										onchange={() => handleVehicleTypeChange(option.value)}
									/>
									<option.icon class="size-4" aria-hidden="true" />
									{option.label}
								</label>
							{/each}
						</div>
					</fieldset>

					<fieldset class="space-y-2">
						<legend class="mb-2 text-sm font-medium">Track</legend>
						<div class="flex flex-wrap items-center gap-6">
							<label for="trackFuel" class="flex cursor-pointer items-center gap-2 text-sm">
								<Switch id="trackFuel" bind:checked={trackFuel} />
								Fuel fill-ups
							</label>
							<label for="trackCharging" class="flex cursor-pointer items-center gap-2 text-sm">
								<Switch id="trackCharging" bind:checked={trackCharging} />
								Charging
							</label>
						</div>
					</fieldset>
				</section>

				<Collapsible.Root bind:open={unitPrefsOpen} class="border-t border-border pt-6">
					<div class="flex items-center justify-between gap-3">
						<div>
							<h2 class="font-semibold">Units</h2>
							<p class="text-sm text-muted-foreground">
								{distanceLabel} · {volumeLabel} · {chargeLabel}
							</p>
						</div>
						<Collapsible.Trigger
							class="h-10 shrink-0 rounded-full border border-border-strong px-4 text-sm font-semibold outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
						>
							{#if unitPrefsOpen}Done{:else}Change<span class="sr-only"> units</span>{/if}
						</Collapsible.Trigger>
					</div>
					<Collapsible.Content>
						<div class="mt-6 grid grid-cols-1 gap-x-5 gap-y-6 md:grid-cols-3">
							<div class="space-y-2">
								<Label for="distanceUnit">Distance</Label>
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
								<Label for="volumeUnit">Fuel volume</Label>
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
										<Select.Item value="gallons_us" label="Gallons (US)">Gallons (US)</Select.Item>
										<Select.Item value="gallons_uk" label="Gallons (UK)">Gallons (UK)</Select.Item>
										<Select.Item value="liters" label="Liters">Liters</Select.Item>
									</Select.Content>
								</Select.Root>
							</div>

							<div class="space-y-2">
								<Label for="chargeUnit">Charge</Label>
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
						</div>
					</Collapsible.Content>
				</Collapsible.Root>

				<FinancingFormSection
					bind:ownershipType
					bind:financingForm
					{errors}
					{isEditMode}
					{vehicle}
					{distanceUnit}
					amortizationPreview={loanTermsChanged ? amortizationPreview : null}
				/>
			</form>

			<FormActionBar>
				{#if demo}
					<DemoSaveNote />
				{/if}
				{#if isEditMode}
					<Button
						type="button"
						variant="outline"
						size="lg"
						onclick={confirmDelete}
						disabled={demo || isDeleting || isSubmitting}
						class="rounded-full text-destructive"
					>
						<Trash2 class="size-4" aria-hidden="true" />
						<span class="max-sm:sr-only">Delete</span>
					</Button>
				{/if}
				<div class="ml-auto flex items-center gap-3">
					<Button
						type="button"
						variant="outline"
						size="lg"
						onclick={handleBack}
						disabled={isSubmitting || isDeleting}
						class="rounded-full"
					>
						Cancel
					</Button>
					<Button
						type="button"
						size="lg"
						onclick={handleSubmit}
						disabled={isSubmitting || isDeleting}
						aria-disabled={demo || undefined}
						aria-describedby={demo ? DEMO_SAVE_NOTE_ID : undefined}
						class="rounded-full"
					>
						{#if isSubmitting}
							<LoaderCircle class="size-4 animate-spin" />
							Saving…
						{:else}
							{isEditMode ? 'Save changes' : 'Save vehicle'}
						{/if}
					</Button>
				</div>
			</FormActionBar>
		</div>

		<AlertDialog bind:open={showDeleteConfirm}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete vehicle</AlertDialogTitle>
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
						class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
					>
						{#if isDeleting}
							<LoaderCircle class="h-4 w-4 animate-spin mr-2" />
							Deleting...
						{:else}
							<Trash2 class="h-4 w-4 mr-2" />
							Delete vehicle
						{/if}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>

		<ConfirmDialog
			bind:open={showPayoffConfirm}
			title={payoffConfirmCopy.title}
			description={payoffConfirmCopy.description}
			confirmLabel={payoffConfirmCopy.confirmLabel}
			destructive={false}
			onConfirm={payOffAndSave}
		/>

		<ConfirmDialog
			bind:open={showUnitChangeConfirm}
			title="Change units for this vehicle?"
			description={unitChangeDescription}
			confirmLabel="Change units"
			destructive={false}
			onConfirm={() => saveVehicle(true)}
		/>
	{/if}
</FormLayout>
