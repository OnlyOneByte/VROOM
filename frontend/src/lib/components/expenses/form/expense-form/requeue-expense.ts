import { appStore } from '#lib/stores/app.svelte.ts';
import { onlineStatus } from '#lib/stores/offline.svelte.ts';
import { replaceParkedExpense, type ReplaceParkedResult } from '#lib/utils/offline-storage.ts';
import { syncManager } from '#lib/utils/sync/sync-manager.ts';
import { gotoDynamic } from '#lib/utils/navigation.ts';
import { toOfflineExpense } from '../offline-expense';
import { buildExpenseData } from './expense-payload';
import type { ExpenseFormState } from './expense-form-state.svelte';

export const REQUEUE_FAILED_MESSAGE =
	"Couldn't update this entry on this device. Check your device's free storage and try again.";

export const REQUEUE_NOT_PARKED_MESSAGE =
	"This entry started syncing or was removed while you were editing, so your changes weren't saved. Check it in the expenses list.";

export const REQUEUE_PHOTOS_UNREADABLE_MESSAGE =
	"This entry's photos couldn't be loaded, so it can't move to another vehicle or date yet. Keep its vehicle and date, or try again later.";

const REQUEUE_REFUSALS: Record<Exclude<ReplaceParkedResult, 'saved'>, string> = {
	'not-parked': REQUEUE_NOT_PARKED_MESSAGE,
	'photos-unreadable': REQUEUE_PHOTOS_UNREADABLE_MESSAGE,
	failed: REQUEUE_FAILED_MESSAGE
};

export async function saveQueuedExpense(state: ExpenseFormState): Promise<void> {
	const queued = state.queuedExpense;
	if (!queued) return;
	state.submitError = null;
	if (!state.validateForm()) {
		Object.keys(state.formData).forEach(field => {
			state.touched[field] = true;
		});
		return;
	}

	state.isSubmitting = true;
	try {
		const expenseData = buildExpenseData(state.formData, {
			currency: state.currencyUnit,
			sourceType: state.sourceType,
			sourceId: state.sourceId
		});
		const result = await replaceParkedExpense(
			queued.id,
			toOfflineExpense(expenseData),
			state.queuedPhotosUnreadable ? null : [...state.pendingFiles]
		);
		if (result !== 'saved') {
			state.submitError = REQUEUE_REFUSALS[result];
			appStore.addNotification({ type: 'error', message: state.submitError });
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
