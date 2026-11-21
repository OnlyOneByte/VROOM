import type { SyncFailureKind } from '#lib/utils/sync/classify-failure.ts';
import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';

export const UNQUEUED_SAVE_MESSAGE =
	'This device could not store the expense — storage is full or site data is blocked. ' +
	'Your entry is still on this form: try again, or copy the values before leaving the page.';

export const UNQUEUED_AFTER_SESSION_END_MESSAGE =
	"Your session ended and this device couldn't store the expense, because storage is full or " +
	"site data is blocked. The expense wasn't saved: sign in again and re-enter it.";

export function submitFailureMessage(error: unknown): string {
	return `Couldn't save this expense. ${userFacingErrorMessage(error)}`;
}

export function canQueueFailedSave(input: {
	isEditMode: boolean;
	isSplitCreate: boolean;
	failureKind: SyncFailureKind;
}): boolean {
	return !input.isEditMode && !input.isSplitCreate && input.failureKind !== 'terminal';
}

export function offlineQueuedMessage(failureKind: SyncFailureKind): string {
	return failureKind === 'auth'
		? 'Signed out — saved on this device. Sign in to sync it.'
		: 'Saved offline due to connection issue. Will sync when online.';
}
