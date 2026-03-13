/**
 * Unit tests for provider duplicate prevention logic.
 * Validates: Requirement 1.6 — different accountEmail allowed, same accountEmail
 * returns 409, different provider types allowed.
 *
 * Tests the pure duplicate-check logic extracted from the POST handler in
 * providers/routes.ts. The real handler runs this inside a transaction.
 */

import { describe, expect, test } from 'bun:test';

interface ExistingProvider {
  id: string;
  config: Record<string, unknown> | null;
}

/**
 * Pure function replicating the duplicate check from providers/routes.ts POST handler.
 * Given existing providers of the same domain+providerType and the new accountEmail,
 * returns the duplicate provider if found, or undefined if no conflict.
 */
function findDuplicate(
  existingProviders: ExistingProvider[],
  newAccountEmail: string | undefined
): ExistingProvider | undefined {
  if (!newAccountEmail) return undefined;

  return existingProviders.find((p) => {
    const cfg = p.config as Record<string, unknown> | null;
    return cfg?.accountEmail === newAccountEmail;
  });
}

describe('Provider duplicate prevention', () => {
  test('different accountEmail allowed — no conflict', () => {
    const existing: ExistingProvider[] = [
      { id: 'prov-1', config: { accountEmail: 'alice@gmail.com' } },
    ];

    const duplicate = findDuplicate(existing, 'bob@gmail.com');
    expect(duplicate).toBeUndefined();
  });

  test('same accountEmail returns conflict', () => {
    const existing: ExistingProvider[] = [
      { id: 'prov-1', config: { accountEmail: 'alice@gmail.com' } },
    ];

    const duplicate = findDuplicate(existing, 'alice@gmail.com');
    expect(duplicate).toBeDefined();
    expect(duplicate?.id).toBe('prov-1');
  });

  test('different provider types allowed — empty existing list means no conflict', () => {
    // When querying for same domain+providerType, a different providerType
    // would return an empty list from the DB query
    const existing: ExistingProvider[] = [];

    const duplicate = findDuplicate(existing, 'alice@gmail.com');
    expect(duplicate).toBeUndefined();
  });

  test('no accountEmail on new provider — no conflict check performed', () => {
    const existing: ExistingProvider[] = [
      { id: 'prov-1', config: { accountEmail: 'alice@gmail.com' } },
    ];

    const duplicate = findDuplicate(existing, undefined);
    expect(duplicate).toBeUndefined();
  });

  test('existing provider with null config — no false positive', () => {
    const existing: ExistingProvider[] = [{ id: 'prov-1', config: null }];

    const duplicate = findDuplicate(existing, 'alice@gmail.com');
    expect(duplicate).toBeUndefined();
  });

  test('multiple existing providers — only matches the correct email', () => {
    const existing: ExistingProvider[] = [
      { id: 'prov-1', config: { accountEmail: 'alice@gmail.com' } },
      { id: 'prov-2', config: { accountEmail: 'bob@gmail.com' } },
      { id: 'prov-3', config: { accountEmail: 'charlie@gmail.com' } },
    ];

    const duplicate = findDuplicate(existing, 'bob@gmail.com');
    expect(duplicate).toBeDefined();
    expect(duplicate?.id).toBe('prov-2');

    const noDuplicate = findDuplicate(existing, 'dave@gmail.com');
    expect(noDuplicate).toBeUndefined();
  });

  test('case-sensitive email comparison — different case is not a duplicate', () => {
    const existing: ExistingProvider[] = [
      { id: 'prov-1', config: { accountEmail: 'Alice@gmail.com' } },
    ];

    // The real code does exact match — different case is allowed
    const duplicate = findDuplicate(existing, 'alice@gmail.com');
    expect(duplicate).toBeUndefined();
  });
});
