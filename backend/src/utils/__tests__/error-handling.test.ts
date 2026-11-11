import { describe, expect, test } from 'bun:test';
import { extractErrorMessage } from '../error-handling';

describe('extractErrorMessage', () => {
  test("an Error's own message is returned", () => {
    expect(extractErrorMessage(new Error('boom'))).toBe('boom');
  });

  test('an Error subclass is still unwrapped to its message', () => {
    class CustomError extends Error {}
    expect(extractErrorMessage(new CustomError('specific'))).toBe('specific');
  });

  test('an Error with an empty message returns the empty string', () => {
    expect(extractErrorMessage(new Error(''))).toBe('');
  });

  test('a non-Error value is converted with String()', () => {
    expect(extractErrorMessage('a string')).toBe('a string');
    expect(extractErrorMessage(42)).toBe('42');
    expect(extractErrorMessage(null)).toBe('null');
    expect(extractErrorMessage(undefined)).toBe('undefined');
    expect(extractErrorMessage({ code: 'X' })).toBe('[object Object]');
  });
});
