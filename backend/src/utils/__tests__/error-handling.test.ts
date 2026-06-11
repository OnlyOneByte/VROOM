/**
 * Unit tests for the backend `extractErrorMessage` — the single source of truth for the VALUE form of
 * the `error instanceof Error ? error.message : String(error)` idiom hand-rolled ~60× across the
 * backend (arch dedup seam, C147). Mirrors the frontend C90 `extract-error-message.test.ts`.
 *
 * The load-bearing contract is the type branch: a real Error yields its `.message`; ANYTHING else is
 * stringified via `String(...)` (NOT a fixed fallback literal — that's a DIFFERENT idiom, e.g.
 * connection.ts's `'Unknown error'` txn message, which deliberately stays inline).
 */

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

  test('an Error with an empty message returns the empty string (branches on TYPE, not truthiness)', () => {
    expect(extractErrorMessage(new Error(''))).toBe('');
  });

  test('a non-Error throw is String()-ified (not a fixed fallback)', () => {
    expect(extractErrorMessage('a string')).toBe('a string');
    expect(extractErrorMessage(42)).toBe('42');
    expect(extractErrorMessage(null)).toBe('null');
    expect(extractErrorMessage(undefined)).toBe('undefined');
    expect(extractErrorMessage({ code: 'X' })).toBe('[object Object]');
  });
});
