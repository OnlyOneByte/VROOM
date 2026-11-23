import { expenseApi } from '#lib/services/expense-api.ts';
import { isOdometerOrderError } from '#lib/services/odometer-api.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import { onlineStatus } from '#lib/stores/offline.svelte.ts';
import { addOfflineExpense, currentOfflineQueueOwner } from '#lib/utils/offline-storage.ts';
import { classifySyncFailure } from '#lib/utils/sync/classify-failure.ts';
import { syncManager } from '#lib/utils/sync/sync-manager.ts';
import { buildSplitConfig } from '#lib/utils/expense-helpers.ts';
import { gotoDynamic } from '#lib/utils/navigation.ts';
import { handleErrorWithNotification, userFacingErrorMessage } from '#lib/utils/error-handling.ts';
import type { ExpenseCategory } from '#lib/types/index.ts';
import { toOfflineExpense } from '../offline-expense';
import { buildExpenseData } from './expense-payload';
import {
	canQueueFailedSave,
	offlineQueuedMessage,
	submitFailureMessage,
	UNQUEUED_AFTER_SESSION_END_MESSAGE,
	UNQUEUED_SAVE_MESSAGE
} from './expense-submit-outcome';
import type { ExpenseFormState } from './expense-form-state.svelte';

const saveClientIds = new WeakMap<ExpenseFormState, string>();

function saveClientId(state: ExpenseFormState): string {
	let clientId = saveClientIds.get(state);
	if (!clientId) {
		clientId = crypto.randomUUID();
		saveClientIds.set(state, clientId);
	}
	return clientId;
}

function reportUnqueuedSave(state: ExpenseFormState, sessionEnded = false): void {
	state.submitError = sessionEnded ? UNQUEUED_AFTER_SESSION_END_MESSAGE : UNQUEUED_SAVE_MESSAGE;
	appStore.addNotification({
		type: 'error',
		message: state.submitError,
		urgent: true,
		duration: 15000
	});
}

async function uploadPendingPhotos(state: ExpenseFormState, entityId: string): Promise<void> {
	if (state.pendingFiles.length === 0) return;
	let failCount = 0;
	for (const file of state.pendingFiles) {
		try {
			await expenseApi.uploadPhoto('expense', entityId, file);
		} catch {
			failCount++;
		}
	}
	if (failCount > 0) {
		appStore.addNotification({
			type: 'warning',
			message: `${failCount} photo${failCount > 1 ? 's' : ''} failed to upload. You can re-upload in edit mode.`
		});
	}
	state.pendingFiles = [];
}

export async function submitExpense(state: ExpenseFormState): Promise<void> {
	const { expenseId, returnTo } = state.ctx;
	state.submitError = null;
	if (!state.validateForm()) {
		Object.keys(state.formData).forEach(field => {
			state.touched[field] = true;
		});
		return;
	}

	state.isSubmitting = true;

	const expenseData = buildExpenseData(state.formData, {
		currency: state.currencyUnit,
		sourceType: state.sourceType,
		sourceId: state.sourceId
	});
	const isSplitCreate = state.isSplit && state.selectedVehicleIds.length >= 2;
	const clientId = saveClientId(state);
	const queueOwner = currentOfflineQueueOwner();

	try {
		if (state.isGroupEditMode && state.groupId) {
			const splitConfig = buildSplitConfig(
				state.splitMethod,
				state.selectedVehicleIds,
				state.splitAllocations
			);
			await expenseApi.updateSplitExpense(state.groupId, {
				splitConfig,
				totalAmount: parseFloat(state.formData.amount)
			});

			appStore.addNotification({
				type: 'success',
				message: 'Split expense updated successfully'
			});
			gotoDynamic(returnTo);
		} else if (state.isEditMode) {
			await expenseApi.updateExpense(expenseId!, {
				...expenseData,
				sourceType: state.clearsFinancingLink ? null : undefined,
				sourceId: state.clearsFinancingLink ? null : undefined
			});

			appStore.addNotification({
				type: 'success',
				message: 'Expense updated successfully'
			});
			gotoDynamic(returnTo);
		} else if (isSplitCreate) {
			const splitConfig = buildSplitConfig(
				state.splitMethod,
				state.selectedVehicleIds,
				state.splitAllocations
			);
			const result = await expenseApi.createSplitExpense({
				splitConfig,
				category: state.formData.category as ExpenseCategory,
				tags: state.formData.tags.length > 0 ? state.formData.tags : undefined,
				date: expenseData.date,
				description: state.formData.description || undefined,
				totalAmount: parseFloat(state.formData.amount)
			});

			const firstSibling = result.siblings[0];
			if (firstSibling) {
				await uploadPendingPhotos(state, firstSibling.id);
			}

			appStore.addNotification({
				type: 'success',
				message: 'Split expense created successfully'
			});
			gotoDynamic(returnTo);
		} else if (onlineStatus.current) {
			const created = await expenseApi.createExpense(expenseData, clientId);

			await uploadPendingPhotos(state, created.id);

			appStore.addNotification({
				type: 'success',
				message: 'Expense added successfully'
			});
			gotoDynamic(returnTo);
		} else {
			const queued = await addOfflineExpense(
				toOfflineExpense(expenseData),
				[...state.pendingFiles],
				clientId,
				queueOwner
			);

			if (!queued) {
				reportUnqueuedSave(state);
				return;
			}

			appStore.addNotification({
				type: 'info',
				message: 'Expense saved offline. Will sync when online.'
			});

			gotoDynamic(returnTo);
		}
	} catch (error) {
		if (import.meta.env.DEV) console.error('Failed to save expense:', error);

		const failureKind = classifySyncFailure(error);

		if (canQueueFailedSave({ isEditMode: state.isEditMode, isSplitCreate, failureKind })) {
			const queued = await addOfflineExpense(
				toOfflineExpense(expenseData),
				[...state.pendingFiles],
				clientId,
				queueOwner
			);

			if (!queued) {
				reportUnqueuedSave(state, failureKind === 'auth');
				return;
			}

			appStore.addNotification({
				type: 'warning',
				message: offlineQueuedMessage(failureKind)
			});
			syncManager.requestAutoSync();

			gotoDynamic(returnTo);
		} else if (isOdometerOrderError(error)) {
			state.refuseMileage(userFacingErrorMessage(error));
		} else {
			state.submitError = submitFailureMessage(error);
		}
	} finally {
		state.isSubmitting = false;
	}
}

export async function deleteExpense(state: ExpenseFormState): Promise<void> {
	const { expenseId, returnTo } = state.ctx;
	if (!expenseId) return;

	state.isDeleting = true;

	try {
		if (state.groupId) {
			await expenseApi.deleteSplitExpense(state.groupId);
		} else {
			await expenseApi.deleteExpense(expenseId);
		}

		appStore.addNotification({
			type: 'success',
			message: 'Expense deleted successfully'
		});
		state.showDeleteConfirm = false;
		gotoDynamic(returnTo);
	} catch (error) {
		handleErrorWithNotification(error, "Couldn't delete this expense");
		throw error;
	} finally {
		state.isDeleting = false;
	}
}
