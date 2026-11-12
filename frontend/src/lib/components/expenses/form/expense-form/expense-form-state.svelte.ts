import { settingsStore } from '#lib/stores/settings.svelte.ts';
import { COMMON_EXPENSE_TAGS } from '#lib/types/index.ts';
import type { Expense, ExpenseFormErrors, Vehicle } from '#lib/types/index.ts';
import { extractUniqueTags } from '#lib/utils/expense-filters.ts';
import { resetSplitAllocations, type SplitAllocationDraft } from '#lib/utils/expense-helpers.ts';
import { getDistanceUnitLabel, isElectricFuelType } from '#lib/utils/units.ts';
import { validateExpenseField } from '../expense-form-validation';
import { calculateMileageEfficiency } from './mileage-efficiency';
import { createEmptyFormData, type ExpenseFormData } from './expense-form-data';
import {
	disableSplit,
	enableSplit,
	toggleSplitVehicle,
	type SplitMethod,
	type SplitState
} from './split-config';

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
	errors = $state<ExpenseFormErrors>({});
	submitError = $state<string | null>(null);
	touched = $state<Record<string, boolean>>({});
	originalExpense = $state<Expense | null>(null);
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

	showPerVehicleMileage = $state(false);
	splitMileages = $state<Record<string, string>>({});

	isInsuranceManaged = $state(false);
	insurancePolicyId = $state<string | null>(null);

	sourceType = $state<string | null>(null);
	sourceId = $state<string | null>(null);

	pendingFiles = $state<File[]>([]);

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
	distLabel = $derived(getDistanceUnitLabel(this.effectiveDistanceUnit, false));

	previousFuelHint = $derived(
		this.lastFuelExpense?.mileage && this.formData.tags.includes('fuel')
			? this.lastFuelExpense.mileage
			: null
	);

	showFuelFields = $derived(this.formData.category === 'fuel');
	isFinancingPayment = $derived(this.sourceType === 'financing' && !!this.sourceId);
	showVolumeField = $derived(this.showFuelFields && !isElectricFuelType(this.formData.fuelType));
	showChargeField = $derived(this.showFuelFields && isElectricFuelType(this.formData.fuelType));

	constructor(ctx: ExpenseFormContext, initialLoading: boolean) {
		this.ctx = ctx;
		this.isLoading = initialLoading;
	}

	private validationContext() {
		return {
			category: this.formData.category,
			vehicle: this.vehicle,
			volumeUnit: this.volumeUnit,
			chargeUnit: this.chargeUnit,
			allVehicleExpenses: this.allVehicleExpenses,
			expenseId: this.ctx.expenseId,
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

		if (field === 'date' && this.formData.mileage) {
			this.handleBlur('mileage');
		}
	};

	validateForm = (): boolean => {
		this.errors = {};
		const fields: string[] = this.isGroupEditMode
			? ['category', 'amount', 'date']
			: ['vehicleId', 'category', 'amount', 'date'];
		if (this.showFuelFields) {
			fields.push('mileage');
			if (this.showVolumeField) fields.push('volume');
			if (this.showChargeField) fields.push('charge');
		}

		const ctx = this.validationContext();
		for (const field of fields) {
			const error = validateExpenseField(field, ctx);
			if (error) this.errors[field] = error;
		}

		return Object.keys(this.errors).length === 0;
	};

	selectCategory = (categoryValue: string) => {
		this.formData.category = categoryValue;
		this.touched['category'] = true;
		this.handleBlur('category');

		if (categoryValue !== 'financial') {
			this.sourceType = null;
			this.sourceId = null;
		}

		if (categoryValue !== 'fuel') {
			this.formData.volume = '';
			this.formData.charge = '';
			this.formData.fuelType = '';
			this.formData.mileage = '';
			this.formData.missedFillup = false;
		}
	};

	handleMileageChange = () => {
		const result = calculateMileageEfficiency({
			category: this.formData.category,
			mileage: this.formData.mileage,
			previousMileage: this.lastFuelExpense?.mileage,
			fuelType: this.formData.fuelType,
			volume: this.formData.volume,
			charge: this.formData.charge
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
