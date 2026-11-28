import { expenseApi } from '#lib/services/expense-api.ts';
import { vehicleApi } from '#lib/services/vehicle-api.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import { gotoDynamic } from '#lib/utils/navigation.ts';
import { offlineExpenseQueue, onlineStatus } from '#lib/stores/offline.svelte.ts';
import {
	cacheVehicleHistory,
	currentOfflineQueueOwner,
	findParkedExpense,
	loadCachedVehicleHistory,
	loadCachedVehicles,
	loadPendingPhotos
} from '#lib/utils/offline-storage.ts';
import type { Expense, Vehicle } from '#lib/types/index.ts';
import {
	ApiError,
	logLoadFailure,
	toError,
	userFacingErrorMessage
} from '#lib/utils/error-handling.ts';
import { toAmountInput, toDateInputValue } from '#lib/utils/formatters.ts';
import { parsePreselectedTags } from './expense-navigation';
import { splitStateFromGroup } from './split-config';
import { readQuickAddMemory } from './quick-add-memory';
import type { ExpenseFormState } from './expense-form-state.svelte';
import { shownExpense } from '#lib/utils/pending-edits.svelte.ts';

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
		const lastUsedId = readQuickAddMemory().vehicleId;
		const vehicle = vehicles.find(v => v.id === lastUsedId) ?? vehicles[0];
		if (vehicle) state.formData.vehicleId = vehicle.id;
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
		logLoadFailure(error, "Couldn't load your vehicles");
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
	state.formData.amount = toAmountInput(queued.amount, state.amountCurrency);
	state.formData.date = toDateInputValue(queued.date);
	state.formData.mileage = queued.mileage?.toString() ?? '';
	state.formData.volume = queued.volume?.toString() ?? '';
	state.formData.charge = queued.charge?.toString() ?? '';
	state.formData.fuelType = queued.fuelType ?? '';
	state.formData.chargerType = queued.chargerType ?? '';
	state.formData.description = queued.description ?? '';
	state.formData.location = queued.location ?? '';
	state.formData.missedFillup = queued.missedFillup ?? false;
	state.sourceType = queued.sourceType ?? null;
	state.sourceId = queued.sourceId ?? null;
	if (queued.clientId) await loadQueuedPhotos(state, queued.clientId);
}

export async function loadQueuedPhotos(state: ExpenseFormState, clientId: string): Promise<void> {
	try {
		state.pendingFiles = await loadPendingPhotos(clientId);
		state.queuedPhotosUnreadable = false;
	} catch {
		state.queuedPhotosUnreadable = true;
	}
}

export function applyPreselections(state: ExpenseFormState, values: PreselectedValues): void {
	if (values.vehicleId) state.formData.vehicleId = values.vehicleId;
	if (values.category) state.formData.category = values.category;
	if (values.amount) state.formData.amount = values.amount;
	if (values.description) state.formData.description = values.description;
	if (values.tags) state.formData.tags = parsePreselectedTags(values.tags);
	if (!values.category) state.applyRememberedCategory();
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
	logLoadFailure(error, `Couldn't load this ${label}`);
}

export async function loadExpense(state: ExpenseFormState): Promise<void> {
	const { expenseId } = state.ctx;
	state.isLoading = true;
	state.expenseError = null;
	try {
		const loaded = await expenseApi.getExpense(expenseId!);
		const expense = loaded && shownExpense(loaded);
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
					state.formData.amount = toAmountInput(splitGroup.groupTotal, state.amountCurrency);
					state.formData.tags = first.tags || [];
					state.formData.date = toDateInputValue(first.date);
					state.formData.description = first.description || '';
					state.isLoading = false;
					return;
				}

				state.isGroupEditMode = true;
				state.formData.category = first.category;
				state.formData.amount = toAmountInput(splitGroup.groupTotal, state.amountCurrency);
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
		state.formData.amount = toAmountInput(expense.amount, state.amountCurrency);
		state.formData.date = toDateInputValue(expense.date);
		state.formData.mileage = expense.mileage?.toString() ?? '';
		state.formData.volume = expense.volume?.toString() ?? '';
		state.formData.charge = expense.charge?.toString() ?? '';
		state.formData.fuelType = expense.fuelType || '';
		state.formData.chargerType = expense.chargerType ?? '';
		state.formData.description = expense.description || '';
		state.formData.location = expense.location || '';
		state.formData.missedFillup = expense.missedFillup ?? false;
		state.paidByDriverId = expense.paidByDriverId ?? null;
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

const LAST_FILLUP_WINDOW = 10;

function latestFillup(newestFirst: Expense[]): Expense | null {
	const newest = newestFirst[0];
	if (!newest) return null;
	return newestFirst
		.filter(fillup => fillup.date === newest.date)
		.reduce((best, fillup) =>
			(fillup.mileage ?? -Infinity) > (best.mileage ?? -Infinity) ? fillup : best
		);
}

export async function loadLastFuelExpense(state: ExpenseFormState): Promise<void> {
	const isCurrent = state.nextLastFuelRequest();
	try {
		const result = await expenseApi.getExpensesByVehicle(state.formData.vehicleId, {
			limit: LAST_FILLUP_WINDOW,
			category: 'fuel'
		});
		if (!isCurrent()) return;
		const fuelExpenses = result.data.filter(e => e.id !== state.ctx.expenseId);
		state.lastFuelExpense = latestFillup(fuelExpenses);
	} catch {
		if (isCurrent()) state.lastFuelExpense = null;
	}
}

export async function loadAllVehicleExpenses(state: ExpenseFormState): Promise<Error | null> {
	const isCurrent = state.nextHistoryRequest();
	state.historyCheckDeferred = false;
	try {
		const vehicleId = state.formData.vehicleId;
		const requestedFor = currentOfflineQueueOwner();
		const result = await expenseApi.getExpensesByVehicle(vehicleId, { limit: 100 });
		cacheVehicleHistory(vehicleId, result.data, requestedFor);
		if (isCurrent()) state.allVehicleExpenses = result.data;
		return null;
	} catch (error) {
		if (!isCurrent()) return null;
		if (onlineStatus.current) {
			state.allVehicleExpenses = [];
			return toError(error);
		}
		const cached = loadCachedVehicleHistory(state.formData.vehicleId);
		state.allVehicleExpenses = [...(cached ?? []), ...queuedExpensesFor(state)];
		state.historyCheckDeferred = !cached;
		return null;
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
	if (failure) logLoadFailure(failure, "Couldn't load this vehicle's details");
}
