import { expenseApi } from '#lib/services/expense-api.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import { onlineStatus } from '#lib/stores/offline.svelte.ts';
import { addOfflineExpense } from '#lib/utils/offline-storage.ts';
import { classifySyncFailure } from '#lib/utils/sync/classify-failure.ts';
import { buildSplitConfig } from '#lib/utils/expense-helpers.ts';
import { gotoDynamic } from '#lib/utils/navigation.ts';
import type { ExpenseCategory } from '#lib/types/index.ts';
import { toOfflineExpense } from '../offline-expense';
import { buildExpenseData } from './expense-payload';
import {
	canQueueFailedSave,
	offlineQueuedMessage,
	submitFailureMessage,
	UNQUEUED_SAVE_MESSAGE
} from './expense-submit-outcome';
import type { ExpenseFormState } from './expense-form-state.svelte';

function reportUnqueuedSave(state: ExpenseFormState): void {
	state.submitError = UNQUEUED_SAVE_MESSAGE;
	appStore.addNotification({ type: 'error', message: state.submitError });
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
	if (!state.validateForm()) {
		Object.keys(state.formData).forEach(field => {
			state.touched[field] = true;
		});
		return;
	}

	state.isSubmitting = true;
	state.submitError = null;

	const expenseData = buildExpenseData(state.formData, {
		currency: state.currencyUnit,
		sourceType: state.sourceType,
		sourceId: state.sourceId
	});
	const isSplitCreate = state.isSplit && state.selectedVehicleIds.length >= 2;

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
			await expenseApi.updateExpense(expenseId!, expenseData);

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
			const created = await expenseApi.createExpense(expenseData);

			await uploadPendingPhotos(state, created.id);

			appStore.addNotification({
				type: 'success',
				message: 'Expense added successfully'
			});
			gotoDynamic(returnTo);
		} else {
			const queued = addOfflineExpense(toOfflineExpense(expenseData));

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
			const queued = addOfflineExpense(toOfflineExpense(expenseData));

			if (!queued) {
				reportUnqueuedSave(state);
				return;
			}

			appStore.addNotification({
				type: 'warning',
				message: offlineQueuedMessage(failureKind)
			});

			gotoDynamic(returnTo);
		} else {
			state.submitError = submitFailureMessage(failureKind, error);
			appStore.addNotification({ type: 'error', message: state.submitError });
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
		gotoDynamic(returnTo);
	} catch (error) {
		if (import.meta.env.DEV) console.error('Failed to delete expense:', error);
		appStore.addNotification({
			type: 'error',
			message: 'Failed to delete expense. Please try again.'
		});
	} finally {
		state.isDeleting = false;
		state.showDeleteConfirm = false;
	}
}
