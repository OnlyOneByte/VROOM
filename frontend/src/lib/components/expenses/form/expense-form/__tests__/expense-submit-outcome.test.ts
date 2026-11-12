import { describe, expect, test } from 'vitest';
import { ApiError } from '#lib/utils/error-handling.ts';
import {
	canQueueFailedSave,
	offlineQueuedMessage,
	submitFailureMessage
} from '../expense-submit-outcome';

describe('submitFailureMessage', () => {
	test('an expired session asks the user to sign in again', () => {
		expect(submitFailureMessage('auth', new ApiError('x', 401))).toBe(
			'Your session has expired. Please sign in again.'
		);
	});

	test('a transient failure reads as a network error', () => {
		expect(submitFailureMessage('transient', new ApiError('x', 503))).toBe(
			'Network error. Please try again.'
		);
	});

	test('a terminal failure shows the server reason', () => {
		expect(
			submitFailureMessage('terminal', new ApiError('Amount must be greater than 0', 400))
		).toBe('Amount must be greater than 0');
	});

	test('a terminal failure with no usable reason falls back to a generic save message', () => {
		expect(submitFailureMessage('terminal', 'boom')).toBe(
			'Could not save this expense. Please try again.'
		);
	});
});

describe('canQueueFailedSave', () => {
	test('a transient create of a single expense is queued', () => {
		expect(
			canQueueFailedSave({ isEditMode: false, isSplitCreate: false, failureKind: 'transient' })
		).toBe(true);
	});

	test('an auth failure is still queued, so nothing is lost while signed out', () => {
		expect(
			canQueueFailedSave({ isEditMode: false, isSplitCreate: false, failureKind: 'auth' })
		).toBe(true);
	});

	test('a server rejection is never queued', () => {
		expect(
			canQueueFailedSave({ isEditMode: false, isSplitCreate: false, failureKind: 'terminal' })
		).toBe(false);
	});

	test('an edit is never queued, since the outbox only creates', () => {
		expect(
			canQueueFailedSave({ isEditMode: true, isSplitCreate: false, failureKind: 'transient' })
		).toBe(false);
	});

	test('a split create is never queued, since the outbox holds one vehicle per entry', () => {
		expect(
			canQueueFailedSave({ isEditMode: false, isSplitCreate: true, failureKind: 'transient' })
		).toBe(false);
	});
});

describe('offlineQueuedMessage', () => {
	test('an auth failure tells the user the entry waits for sign-in', () => {
		expect(offlineQueuedMessage('auth')).toBe(
			'Signed out — saved on this device. Sign in to sync it.'
		);
	});

	test('a connection failure tells the user it will sync when online', () => {
		expect(offlineQueuedMessage('transient')).toBe(
			'Saved offline due to connection issue. Will sync when online.'
		);
	});
});
