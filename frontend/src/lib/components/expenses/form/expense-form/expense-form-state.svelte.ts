import { settingsStore } from '#lib/stores/settings.svelte.ts';
import { COMMON_EXPENSE_TAGS } from '#lib/types/index.ts';
import type { Expense, ExpenseFormErrors, Vehicle } from '#lib/types/index.ts';
import { extractUniqueTags } from '#lib/utils/expense-filters.ts';
import { resetSplitAllocations, type SplitAllocationDraft } from '#lib/utils/expense-helpers.ts';
import { getDistanceUnitLabel, isElectricFuelType } from '#lib/utils/units.ts';
import { latest } from '#lib/utils/latest-request.ts';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';
import { hasMileageEntry, validateExpenseField } from '../expense-form-validation';
import { calculateMileageEfficiency } from './mileage-efficiency';
import { createEmptyFormData, type ExpenseFormData } from './expense-form-data';
import { readQuickAddMemory } from './quick-add-memory';
import {
	disableSplit,
	enableSplit,
	toggleSplitVehicle,
	type SplitMethod,
	type SplitState
} from './split-config';

export const FUEL_NEEDS_VEHICLE_MESSAGE =
	"Couldn't load this vehicle's details, so this fill-up can't be saved yet.";

export interface ExpenseFormContext {
	readonly expenseId: string | undefined;
	readonly returnTo: string;
}

export class ExpenseFormState {
	readonly ctx: ExpenseFormContext;

	formData = $state<ExpenseFormData>(createEmptyFormData());
	isLoading = $state(false);
	isSubmitting = $state(false);
	isDeleting = $state(false);
	showDeleteConfirm = $state(false);
	vehicles = $state<Vehicle[]>([]);
	vehiclesError = $state<string | null>(null);
	expenseError = $state<string | null>(null);
	vehicleError = $state<string | null>(null);
	historyCheckDeferred = $state(false);
	errors = $state<ExpenseFormErrors>({});
	submitError = $state<string | null>(null);
	touched = $state<Record<string, boolean>>({});
	originalExpense = $state<Expense | null>(null);
	paidByDriverId = $state<string | null | undefined>(undefined);
	vehicle = $state<Vehicle | null>(null);
	lastFuelExpense = $state<Expense | null>(null);
	allVehicleExpenses = $state<Expense[]>([]);
	showMpgCalculation = $state(false);
	calculatedMpg = $state<number | null>(null);
	calculatedEfficiency = $state<number | null>(null);

	isSplit = $state(false);
	splitMethod = $state<SplitMethod>('even');
	splitAllocations = $state<SplitAllocationDraft[]>([]);
	selectedVehicleIds = $state<string[]>([]);

	isGroupEditMode = $state(false);
	groupId = $state<string | null>(null);

	isInsuranceManaged = $state(false);

	sourceType = $state<string | null>(null);
	sourceId = $state<string | null>(null);

	pendingFiles = $state<File[]>([]);
	queuedPhotosUnreadable = $state(false);

	queuedExpense = $state<OfflineExpense | null>(null);
	categoryFromMemory = $state(false);

	readonly nextVehicleRequest = latest();
	readonly nextLastFuelRequest = latest();
	readonly nextHistoryRequest = latest();
	readonly nextContextRequest = latest();

	get isEditMode(): boolean {
		return !!this.ctx.expenseId;
	}

	canDuplicate = $derived(this.isEditMode && !this.isGroupEditMode && !this.isInsuranceManaged);

	parsedTotalAmount = $derived(parseFloat(this.formData.amount) || 0);

	tagSuggestions = $derived.by(() => {
		const historical = extractUniqueTags(this.allVehicleExpenses);
		const common: readonly string[] = COMMON_EXPENSE_TAGS;
		return [...common, ...historical.filter(t => !common.includes(t))];
	});

	settings = $derived(settingsStore.settings);
	volumeUnit = $derived(this.settings?.unitPreferences?.volumeUnit || 'gallons_us');
	chargeUnit = $derived(this.settings?.unitPreferences?.chargeUnit || 'kwh');
	distanceUnit = $derived(this.settings?.unitPreferences?.distanceUnit || 'miles');
	currencyUnit = $derived(this.settings?.currencyUnit || 'USD');

	effectiveDistanceUnit = $derived(
		this.vehicle?.unitPreferences?.distanceUnit ?? this.distanceUnit
	);
	effectiveVolumeUnit = $derived(this.vehicle?.unitPreferences?.volumeUnit ?? this.volumeUnit);
	effectiveChargeUnit = $derived(this.vehicle?.unitPreferences?.chargeUnit ?? this.chargeUnit);
	distLabel = $derived(getDistanceUnitLabel(this.effectiveDistanceUnit, false));

	showFuelFields = $derived(this.formData.category === 'fuel');
	previousFuelHint = $derived(
		this.showFuelFields && this.lastFuelExpense?.mileage ? this.lastFuelExpense.mileage : null
	);
	asksForMileage = $derived(!this.isSplit || this.selectedVehicleIds.length < 2);
	isFinancingPayment = $derived(
		this.sourceType === 'financing' && !!this.sourceId && this.formData.category === 'financial'
	);
	clearsFinancingLink = $derived(
		this.isEditMode && this.originalExpense?.sourceType === 'financing' && !this.isFinancingPayment
	);
	showVolumeField = $derived(this.showFuelFields && !isElectricFuelType(this.formData.fuelType));
	showChargeField = $derived(this.showFuelFields && isElectricFuelType(this.formData.fuelType));
	hasSplitVehicles = $derived(
		(!this.isEditMode || this.isGroupEditMode) && this.vehicles.length >= 2
	);
	canSplit = $derived(this.hasSplitVehicles && !this.showFuelFields && !this.queuedExpense);
	showFuelSplitHint = $derived(this.hasSplitVehicles && this.showFuelFields && !this.isSplit);

	constructor(ctx: ExpenseFormContext, initialLoading: boolean) {
		this.ctx = ctx;
		this.isLoading = initialLoading;
	}

	private validationContext() {
		return {
			category: this.formData.category,
			vehicle: this.vehicle,
			volumeUnit: this.effectiveVolumeUnit,
			chargeUnit: this.effectiveChargeUnit,
			allVehicleExpenses: this.allVehicleExpenses,
			expenseId: this.ctx.expenseId ?? this.queuedExpense?.id,
			formData: this.formData as unknown as Record<string, string | string[]>
		};
	}

	// Arrow-function fields: handlers are passed unbound as callbacks, so they must not become methods.
	applySplitState = (next: SplitState) => {
		this.splitMethod = next.splitMethod;
		this.selectedVehicleIds = next.selectedVehicleIds;
		this.splitAllocations = next.splitAllocations;
	};

	handleBlur = (field: string) => {
		this.touched[field] = true;
		const error = validateExpenseField(field, this.validationContext());
		if (error) {
			this.errors[field] = error;
		} else {
			delete this.errors[field];
			this.errors = { ...this.errors };
		}

		if (field === 'date' && hasMileageEntry(this.formData.mileage)) {
			this.handleBlur('mileage');
		}
	};

	refuseMileage = (message: string) => {
		this.touched['mileage'] = true;
		this.errors = { ...this.errors, mileage: message };
	};

	validateForm = (): boolean => {
		this.errors = {};
		const fields: string[] = this.isGroupEditMode
			? ['category', 'amount', 'date']
			: ['vehicleId', 'category', 'amount', 'date'];
		const fuelNeedsVehicle = this.showFuelFields && !!this.vehicleError && !this.isGroupEditMode;
		if (this.showFuelFields || (this.asksForMileage && hasMileageEntry(this.formData.mileage))) {
			fields.push('mileage');
		}
		if (this.showFuelFields) {
			if (this.showVolumeField) fields.push('volume');
			if (this.showChargeField) fields.push('charge');
		}

		const ctx = this.validationContext();
		for (const field of fields) {
			if (fuelNeedsVehicle && (field === 'volume' || field === 'charge')) continue;
			const error = validateExpenseField(field, ctx);
			if (error) this.errors[field] = error;
		}
		if (fuelNeedsVehicle) this.errors['vehicleDetails'] = FUEL_NEEDS_VEHICLE_MESSAGE;

		return Object.keys(this.errors).length === 0;
	};

	selectCategory = (categoryValue: string) => {
		this.applyCategory(categoryValue);
		this.categoryFromMemory = false;
		this.touched['category'] = true;
		this.handleBlur('category');
	};

	applyRememberedCategory = () => {
		if (this.isEditMode || this.queuedExpense || this.isSplit) return;
		if (this.formData.category && !this.categoryFromMemory) return;
		const remembered = readQuickAddMemory().categoryByVehicle[this.formData.vehicleId];
		if (!remembered || remembered === this.formData.category) return;
		this.applyCategory(remembered);
		this.categoryFromMemory = true;
	};

	private applyCategory(categoryValue: string) {
		this.formData.category = categoryValue;

		if (categoryValue === 'fuel' && this.isSplit && !this.isGroupEditMode) {
			this.handleSplitToggle(false);
		}
	}

	handleMileageChange = () => {
		const result = calculateMileageEfficiency({
			category: this.formData.category,
			mileage: this.formData.mileage,
			previousMileage: this.lastFuelExpense?.mileage,
			fuelType: this.formData.fuelType,
			volume: this.formData.volume,
			charge: this.formData.charge,
			distanceUnit: this.effectiveDistanceUnit,
			volumeUnit: this.effectiveVolumeUnit
		});
		if (!result) return;
		this.calculatedMpg = result.calculatedMpg;
		this.calculatedEfficiency = result.calculatedEfficiency;
		this.showMpgCalculation = result.showMpgCalculation;
	};

	handleVehicleSelect = (vehicleId: string) => {
		this.formData.vehicleId = vehicleId;
		this.touched['vehicleId'] = true;
		this.handleBlur('vehicleId');
		this.applyRememberedCategory();
	};

	handleSplitToggle = (checked: boolean) => {
		this.isSplit = checked;
		if (checked) {
			this.applySplitState(enableSplit(this.formData.vehicleId, this.selectedVehicleIds));
		} else {
			const { vehicleId, state: next } = disableSplit(this.selectedVehicleIds);
			if (vehicleId) this.formData.vehicleId = vehicleId;
			this.applySplitState(next);
		}
	};

	handleSplitVehicleToggle = (vehicleId: string) => {
		this.selectedVehicleIds = toggleSplitVehicle(this.selectedVehicleIds, vehicleId);
		this.splitAllocations = resetSplitAllocations(this.splitMethod, this.selectedVehicleIds);
	};

	handleMethodChange = (method: SplitMethod) => {
		this.splitMethod = method;
		this.splitAllocations = resetSplitAllocations(method, this.selectedVehicleIds);
	};

	handleAllocationsChange = (allocs: SplitAllocationDraft[]) => {
		this.splitAllocations = allocs;
	};
}
