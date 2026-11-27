import { appStore } from '#lib/stores/app.svelte.ts';
import { syncState } from '#lib/stores/offline.svelte.ts';
import { expenseApi } from '#lib/services/expense-api.ts';
import { loadOfflineExpenses, removeOfflineExpense } from '#lib/utils/offline-storage.ts';
import { scheduleDelete, UNDO_WINDOW_MS } from '#lib/utils/pending-deletes.svelte.ts';
import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
import { formatCurrency, formatNumberUpTo } from '#lib/utils/formatters.ts';
import { getElectricEfficiencyLabel, getFuelEfficiencyLabel } from '#lib/utils/units.ts';
import { getVehicleDisplayName } from '#lib/utils/vehicle-helpers.ts';
import type { Expense } from '#lib/types/index.ts';
import type { ExpenseFormState } from './expense-form-state.svelte';

type CreatePayload = Parameters<typeof expenseApi.createExpense>[0];

export interface AddedExpense {
	clientId: string;
	payload: CreatePayload;
	created?: Expense;
}

export interface SavedToast {
	message: string;
	description?: string | undefined;
}

const SYNC_POLL_MS = 100;
const SYNC_WAIT_POLLS = 100;

function efficiencyLine(state: ExpenseFormState): string | undefined {
	if (!state.showFuelFields || !state.showMpgCalculation || state.formData.missedFillup) {
		return undefined;
	}
	const distance = state.effectiveDistanceUnit;
	if (state.showChargeField) {
		if (!state.calculatedEfficiency) return undefined;
		const unit = getElectricEfficiencyLabel(distance, state.effectiveChargeUnit);
		return `${formatNumberUpTo(state.calculatedEfficiency, 1)} ${unit} since last charge`;
	}
	if (!state.calculatedMpg) return undefined;
	const unit = getFuelEfficiencyLabel(distance, state.effectiveVolumeUnit);
	return `${formatNumberUpTo(state.calculatedMpg, 1)} ${unit} since last fill-up`;
}

export function savedToast(state: ExpenseFormState): SavedToast {
	const amount = formatCurrency(parseFloat(state.formData.amount), state.currencyUnit);
	const vehicle = state.vehicles.find(v => v.id === state.formData.vehicleId);
	return {
		message: vehicle ? `Saved ${amount} for ${getVehicleDisplayName(vehicle)}` : `Saved ${amount}`,
		description: efficiencyLine(state)
	};
}

async function syncSettled(): Promise<void> {
	for (let i = 0; i < SYNC_WAIT_POLLS && syncState.current === 'syncing'; i++) {
		await new Promise(resolve => setTimeout(resolve, SYNC_POLL_MS));
	}
}

export async function undoAdd(added: AddedExpense): Promise<void> {
	try {
		if (added.created) {
			scheduleDelete(added.created);
			return;
		}
		await syncSettled();
		const local = loadOfflineExpenses().find(entry => entry.clientId === added.clientId);
		if (local) removeOfflineExpense(local.id);
		if (local && !local.synced && !local.serverId) {
			appStore.addNotification({ type: 'success', message: 'Expense removed' });
			return;
		}
		scheduleDelete(await expenseApi.createExpense(added.payload, added.clientId));
	} catch (error) {
		appStore.addNotification({
			type: 'error',
			message: "Couldn't undo the expense",
			description: userFacingErrorMessage(error),
			duration: Number.POSITIVE_INFINITY,
			action: { label: 'Retry', onClick: () => void undoAdd(added) }
		});
	}
}

export function announceAdded(toast: SavedToast, added: AddedExpense): void {
	appStore.addNotification({
		type: 'success',
		...toast,
		duration: UNDO_WINDOW_MS,
		action: { label: 'Undo', onClick: () => void undoAdd(added) }
	});
}
