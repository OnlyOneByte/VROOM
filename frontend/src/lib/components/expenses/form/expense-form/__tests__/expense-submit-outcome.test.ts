import { describe, expect, test } from 'vitest';
import { ApiError, NetworkError } from '#lib/utils/error-handling.ts';
import {
	canQueueFailedSave,
	offlineQueuedMessage,
	submitFailureMessage
} from '../expense-submit-outcome';

describe('submitFailureMessage', () => {
	test('an expired session asks the user to sign in again', () => {
		expect(
			submitFailureMessage(new ApiError('Unauthorized', 401, undefined, 'AuthenticationError'))
		).toBe("Couldn't save this expense. Your session has ended. Sign in again to continue.");
	});

	test('a dropped connection asks the user to check it', () => {
		expect(submitFailureMessage(new NetworkError(new TypeError('fetch failed')))).toBe(
			"Couldn't save this expense. Check your connection and try again."
		);
	});

	test('a server outage says so instead of blaming the network', () => {
		expect(submitFailureMessage(new ApiError('x', 503))).toBe(
			"Couldn't save this expense. Something went wrong on our side. Try again in a moment."
		);
	});

	test('a terminal failure says the save failed, then gives the reason as a sentence', () => {
		expect(submitFailureMessage(new ApiError('Amount must be greater than 0', 400))).toBe(
			"Couldn't save this expense. Amount must be greater than 0."
		);
	});

	test('a schema rejection names the fields instead of the schema wording', () => {
		const error = new ApiError('Validation failed', 400, {
			issues: [{ path: ['amount'], message: 'Too small: expected number to be >0' }]
		});
		expect(submitFailureMessage(error)).toBe(
			"Couldn't save this expense. Check the amount, then try again."
		);
	});

	test('a terminal failure with no usable reason falls back to a generic message', () => {
		expect(submitFailureMessage('boom')).toBe(
			"Couldn't save this expense. Something went wrong. Try again, and reload the page if it keeps happening."
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
