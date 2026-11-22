import { expenseApi } from '#lib/services/expense-api.ts';
import { vehicleApi } from '#lib/services/vehicle-api.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import { gotoDynamic } from '#lib/utils/navigation.ts';
import { offlineExpenseQueue, onlineStatus } from '#lib/stores/offline.svelte.ts';
import {
	cacheVehicleHistory,
	findParkedExpense,
	loadCachedVehicleHistory,
	loadCachedVehicles,
	loadPendingPhotos
} from '#lib/utils/offline-storage.ts';
import type { Expense, Vehicle } from '#lib/types/index.ts';
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

interface PreselectedValues {
	vehicleId: string | null;
	category: string | null;
	amount: string | null;
	description: string | null;
	tags: string | null;
}

function useVehicles(state: ExpenseFormState, vehicles: Vehicle[]): void {
	state.vehicles = vehicles;
	state.vehiclesError = null;
	if (!state.isEditMode && vehicles.length > 0 && !state.formData.vehicleId) {
		const firstVehicle = vehicles[0];
		if (firstVehicle) state.formData.vehicleId = firstVehicle.id;
	}
}

export async function loadVehicles(state: ExpenseFormState): Promise<void> {
	try {
		const vehicles = await vehicleApi.getVehicles();
		useVehicles(state, vehicles);
	} catch (error) {
		const cached = loadCachedVehicles();
		if (!onlineStatus.current && cached.length > 0) {
			useVehicles(state, cached);
			return;
		}
		state.vehiclesError = userFacingErrorMessage(error);
		handleErrorWithNotification(error, "Couldn't load your vehicles");
	}
}

export async function loadQueuedExpense(state: ExpenseFormState, id: string): Promise<void> {
	const queued = findParkedExpense(id);
	if (!queued) {
		appStore.addNotification({
			type: 'error',
			message: 'That entry is no longer waiting to sync.'
		});
		gotoDynamic(state.ctx.returnTo);
		return;
	}
	state.queuedExpense = queued;
	state.formData.vehicleId = queued.vehicleId;
	state.formData.tags = queued.tags ?? [];
	state.formData.category = queued.category;
	state.formData.amount = queued.amount.toString();
	state.formData.date = toDateInputValue(queued.date);
	state.formData.mileage = queued.mileage?.toString() ?? '';
	state.formData.volume = queued.volume?.toString() ?? '';
	state.formData.charge = queued.charge?.toString() ?? '';
	state.formData.fuelType = queued.fuelType ?? '';
	state.formData.description = queued.description ?? '';
	state.formData.location = queued.location ?? '';
	state.formData.missedFillup = queued.missedFillup ?? false;
	state.sourceType = queued.sourceType ?? null;
	state.sourceId = queued.sourceId ?? null;
	if (queued.clientId) {
		try {
			state.pendingFiles = await loadPendingPhotos(queued.clientId);
		} catch {
			state.queuedPhotosUnreadable = true;
		}
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
		const cached = onlineStatus.current
			? undefined
			: loadCachedVehicles().find(vehicle => vehicle.id === state.formData.vehicleId);
		state.vehicle = cached ?? null;
		return cached ? null : toError(error);
	}
}

export async function loadLastFuelExpense(state: ExpenseFormState): Promise<void> {
	const isCurrent = state.nextLastFuelRequest();
	try {
		const result = await expenseApi.getExpensesByVehicle(state.formData.vehicleId, {
			limit: 2,
			category: 'fuel'
		});
		if (!isCurrent()) return;
		const fuelExpenses = result.data.filter((e: { id: string }) => e.id !== state.ctx.expenseId);
		state.lastFuelExpense = fuelExpenses[0] ?? null;
	} catch {
		if (isCurrent()) state.lastFuelExpense = null;
	}
}

export async function loadAllVehicleExpenses(state: ExpenseFormState): Promise<Error | null> {
	const isCurrent = state.nextHistoryRequest();
	try {
		const vehicleId = state.formData.vehicleId;
		const result = await expenseApi.getExpensesByVehicle(vehicleId, { limit: 100 });
		cacheVehicleHistory(vehicleId, result.data);
		if (isCurrent()) state.allVehicleExpenses = result.data;
		return null;
	} catch (error) {
		if (!isCurrent()) return null;
		const cached = onlineStatus.current ? null : loadCachedVehicleHistory(state.formData.vehicleId);
		state.allVehicleExpenses = cached ? [...cached, ...queuedExpensesFor(state)] : [];
		return cached ? null : toError(error);
	}
}

function queuedExpensesFor(state: ExpenseFormState): Expense[] {
	return offlineExpenseQueue.current
		.filter(queued => !queued.synced && queued.vehicleId === state.formData.vehicleId)
		.map(queued => ({ ...queued, tags: queued.tags ?? [] }) as unknown as Expense);
}

export async function loadVehicleContext(state: ExpenseFormState): Promise<void> {
	const isCurrent = state.nextContextRequest();
	const [vehicleFailure, , historyFailure] = await Promise.all([
		loadVehicle(state),
		loadLastFuelExpense(state),
		loadAllVehicleExpenses(state)
	]);
	if (!isCurrent()) return;
	const failure = vehicleFailure ?? historyFailure;
	state.vehicleError = failure ? userFacingErrorMessage(failure) : null;
	if (failure) handleErrorWithNotification(failure, "Couldn't load this vehicle's details");
}
