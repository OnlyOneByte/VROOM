import { expenseApi } from '#lib/services/expense-api.ts';
import { vehicleApi } from '#lib/services/vehicle-api.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import { gotoDynamic } from '#lib/utils/navigation.ts';
import {
	ApiError,
	handleErrorWithNotification,
	toError,
	userFacingErrorMessage
} from '#lib/utils/error-handling.ts';
import { toDateInputValue } from '#lib/utils/formatters.ts';
import { parsePreselectedTags } from './expense-navigation';
import { splitStateFromGroup } from './split-config';
import type { ExpenseFormState } from './expense-form-state.svelte';

export interface PreselectedValues {
	vehicleId: string | null;
	category: string | null;
	amount: string | null;
	description: string | null;
	tags: string | null;
}

export async function loadVehicles(state: ExpenseFormState): Promise<void> {
	try {
		state.vehicles = await vehicleApi.getVehicles();
		state.vehiclesError = null;
		if (!state.isEditMode && state.vehicles.length > 0 && !state.formData.vehicleId) {
			const firstVehicle = state.vehicles[0];
			if (firstVehicle) state.formData.vehicleId = firstVehicle.id;
		}
	} catch (error) {
		state.vehiclesError = userFacingErrorMessage(error);
		handleErrorWithNotification(error, 'Failed to load vehicles');
	}
}

export function applyPreselections(state: ExpenseFormState, values: PreselectedValues): void {
	if (values.vehicleId) state.formData.vehicleId = values.vehicleId;
	if (values.category) state.formData.category = values.category;
	if (values.amount) state.formData.amount = values.amount;
	if (values.description) state.formData.description = values.description;
	if (values.tags) state.formData.tags = parsePreselectedTags(values.tags);
}

function leaveGoneRecord(state: ExpenseFormState, label: string): void {
	appStore.addNotification({ type: 'error', message: `That ${label} no longer exists.` });
	gotoDynamic(state.ctx.returnTo);
}

function reportExpenseLoadFailure(state: ExpenseFormState, error: unknown, label: string): void {
	if (error instanceof ApiError && error.statusCode === 404) {
		leaveGoneRecord(state, label);
		return;
	}
	state.expenseError = userFacingErrorMessage(error);
	handleErrorWithNotification(error, `Couldn't load this ${label}`);
}

export async function loadExpense(state: ExpenseFormState): Promise<void> {
	const { expenseId } = state.ctx;
	state.isLoading = true;
	state.expenseError = null;
	try {
		const expense = await expenseApi.getExpense(expenseId!);
		if (!expense) {
			leaveGoneRecord(state, 'expense');
			return;
		}

		state.originalExpense = expense;
		if (expense.sourceType === 'financing' && expense.sourceId) {
			state.sourceType = expense.sourceType;
			state.sourceId = expense.sourceId;
		}

		if (expense.groupId) {
			state.groupId = expense.groupId;
			try {
				const splitGroup = await expenseApi.getSplitExpense(expense.groupId);
				const first = splitGroup.siblings[0];
				if (!first) {
					leaveGoneRecord(state, 'split expense');
					return;
				}

				const isInsurance = first.tags?.includes('insurance') ?? false;
				if (isInsurance) {
					state.isInsuranceManaged = true;
					state.formData.category = first.category;
					state.formData.amount = splitGroup.groupTotal.toString();
					state.formData.tags = first.tags || [];
					state.formData.date = toDateInputValue(first.date);
					state.formData.description = first.description || '';
					state.isLoading = false;
					return;
				}

				state.isGroupEditMode = true;
				state.formData.category = first.category;
				state.formData.amount = splitGroup.groupTotal.toString();
				state.formData.tags = first.tags || [];
				state.formData.date = toDateInputValue(first.date);
				state.formData.description = first.description || '';

				state.isSplit = true;
				state.applySplitState(
					splitStateFromGroup(splitGroup.splitMethod, splitGroup.groupTotal, splitGroup.siblings)
				);
			} catch (err) {
				reportExpenseLoadFailure(state, err, 'split expense');
				return;
			}
			state.isLoading = false;
			return;
		}

		state.formData.vehicleId = expense.vehicleId;
		state.formData.tags = expense.tags || [];
		state.formData.category = expense.category;
		state.formData.amount = expense.amount.toString();
		state.formData.date = toDateInputValue(expense.date);
		state.formData.mileage = expense.mileage?.toString() ?? '';
		state.formData.volume = expense.volume?.toString() ?? '';
		state.formData.charge = expense.charge?.toString() ?? '';
		state.formData.fuelType = expense.fuelType || '';
		state.formData.description = expense.description || '';
		state.formData.location = expense.location || '';
		state.formData.missedFillup = expense.missedFillup ?? false;
	} catch (error) {
		reportExpenseLoadFailure(state, error, 'expense');
	} finally {
		state.isLoading = false;
	}
}

export async function loadVehicle(state: ExpenseFormState): Promise<Error | null> {
	const isCurrent = state.nextVehicleRequest();
	try {
		const vehicle = await vehicleApi.getVehicle(state.formData.vehicleId);
		if (isCurrent()) state.vehicle = vehicle;
		return null;
	} catch (error) {
		if (!isCurrent()) return null;
		state.vehicle = null;
		return toError(error);
	}
}

export async function loadLastFuelExpense(state: ExpenseFormState): Promise<Error | null> {
	const isCurrent = state.nextLastFuelRequest();
	try {
		const result = await expenseApi.getExpensesByVehicle(state.formData.vehicleId, {
			limit: 2,
			category: 'fuel'
		});
		if (!isCurrent()) return null;
		const fuelExpenses = result.data.filter((e: { id: string }) => e.id !== state.ctx.expenseId);
		state.lastFuelExpense = fuelExpenses[0] ?? null;
		return null;
	} catch (error) {
		if (!isCurrent()) return null;
		state.lastFuelExpense = null;
		return toError(error);
	}
}

export async function loadAllVehicleExpenses(state: ExpenseFormState): Promise<Error | null> {
	const isCurrent = state.nextHistoryRequest();
	try {
		const result = await expenseApi.getExpensesByVehicle(state.formData.vehicleId, { limit: 100 });
		if (isCurrent()) state.allVehicleExpenses = result.data;
		return null;
	} catch (error) {
		if (!isCurrent()) return null;
		state.allVehicleExpenses = [];
		return toError(error);
	}
}

export async function loadVehicleContext(state: ExpenseFormState): Promise<void> {
	const isCurrent = state.nextContextRequest();
	const failures = await Promise.all([
		loadVehicle(state),
		loadLastFuelExpense(state),
		loadAllVehicleExpenses(state)
	]);
	const failure = failures.find(error => error !== null);
	if (!isCurrent()) return;
	state.vehicleError = failure ? userFacingErrorMessage(failure) : null;
	if (failure) handleErrorWithNotification(failure, "Failed to load this vehicle's details");
}
