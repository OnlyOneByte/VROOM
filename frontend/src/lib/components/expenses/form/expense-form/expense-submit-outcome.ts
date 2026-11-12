import type { SyncFailureKind } from '#lib/utils/sync/classify-failure.ts';
import { extractErrorMessage } from '#lib/utils/error-handling.ts';

export const UNQUEUED_SAVE_MESSAGE =
	'This device could not store the expense — storage is full or site data is blocked. ' +
	'Your entry is still on this form: try again, or copy the values before leaving the page.';

export function submitFailureMessage(kind: SyncFailureKind, error: unknown): string {
	if (kind === 'auth') return 'Your session has expired. Please sign in again.';
	if (kind === 'transient') return 'Network error. Please try again.';
	return extractErrorMessage(error, 'Could not save this expense. Please try again.');
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
