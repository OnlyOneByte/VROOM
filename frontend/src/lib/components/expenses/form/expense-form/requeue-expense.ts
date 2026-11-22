import { appStore } from '#lib/stores/app.svelte.ts';
import { onlineStatus } from '#lib/stores/offline.svelte.ts';
import { replaceOfflineExpense } from '#lib/utils/offline-storage.ts';
import { syncManager } from '#lib/utils/sync/sync-manager.ts';
import { gotoDynamic } from '#lib/utils/navigation.ts';
import { toOfflineExpense } from '../offline-expense';
import { buildExpenseData } from './expense-payload';
import type { ExpenseFormState } from './expense-form-state.svelte';

export const REQUEUE_FAILED_MESSAGE =
	"Couldn't update this entry on this device. Check your device's free storage and try again.";

export async function saveQueuedExpense(state: ExpenseFormState): Promise<void> {
	const queued = state.queuedExpense;
	if (!queued) return;
	if (!state.validateForm()) {
		Object.keys(state.formData).forEach(field => {
			state.touched[field] = true;
		});
		return;
	}

	state.isSubmitting = true;
	state.submitError = null;
	try {
		const expenseData = buildExpenseData(state.formData, {
			currency: state.currencyUnit,
			sourceType: state.sourceType,
			sourceId: state.sourceId
		});
		const saved = await replaceOfflineExpense(queued.id, toOfflineExpense(expenseData), [
			...state.pendingFiles
		]);
		if (!saved) {
			state.submitError = REQUEUE_FAILED_MESSAGE;
			appStore.addNotification({ type: 'error', message: REQUEUE_FAILED_MESSAGE });
			return;
		}
		appStore.addNotification({
			type: 'success',
			message: onlineStatus.current
				? 'Entry updated. Syncing it now.'
				: "Entry updated. It will sync when you're back online."
		});
		if (onlineStatus.current) {
			void syncManager.syncAll({ skipConflicted: true }).catch(() => syncManager.requestAutoSync());
		} else {
			syncManager.requestAutoSync();
		}
		gotoDynamic(state.ctx.returnTo);
	} finally {
		state.isSubmitting = false;
	}
}
