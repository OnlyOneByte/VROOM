import { describe, expect, test } from 'vitest';
import { extractErrorMessage } from '../error-handling';

describe('extractErrorMessage', () => {
	test("an Error's own message wins over the fallback", () => {
		expect(extractErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
	});

	test('a subclass of Error is still unwrapped to its message', () => {
		class CustomError extends Error {}
		expect(extractErrorMessage(new CustomError('specific'), 'fallback')).toBe('specific');
	});

	test('a non-Error throw falls back to the literal', () => {
		expect(extractErrorMessage('a string', 'fallback')).toBe('fallback');
		expect(extractErrorMessage({ message: 'lookalike' }, 'fallback')).toBe('fallback');
		expect(extractErrorMessage(undefined, 'fallback')).toBe('fallback');
		expect(extractErrorMessage(null, 'fallback')).toBe('fallback');
		expect(extractErrorMessage(42, 'fallback')).toBe('fallback');
	});

	test('an Error with an empty message returns the empty string (does NOT fall back)', () => {
		expect(extractErrorMessage(new Error(''), 'fallback')).toBe('');
	});
});
