/**
 * Unit tests for createSheetsServiceForProvider logic.
 * Validates: Requirement 7 — correct token extraction, provider not found,
 * missing token, ownership rejection.
 *
 * Tests the pure logic of createSheetsServiceForProvider by simulating
 * the DB query, decryption, and validation steps.
 */

import { describe, expect, test } from 'bun:test';
import { NotFoundError, ValidationError } from '../../../errors';

interface ProviderRow {
  id: string;
  userId: string;
  domain: string;
  status: string;
  credentials: string;
}

/**
 * Pure function replicating the createSheetsServiceForProvider logic.
 * Given a provider row lookup result and a decrypt function, returns
 * the refresh token or throws the appropriate error.
 */
function extractRefreshToken(
  providerRows: ProviderRow[],
  decryptFn: (encrypted: string) => string
): string {
  if (!providerRows.length) {
    throw new NotFoundError('Provider');
  }

  let credentials: { refreshToken?: string };
  try {
    credentials = JSON.parse(decryptFn(providerRows[0].credentials)) as { refreshToken?: string };
  } catch {
    throw new ValidationError('Failed to decrypt provider credentials');
  }

  if (!credentials.refreshToken) {
    throw new ValidationError(
      'Provider has no refresh token. Please re-connect your Google account.'
    );
  }

  return credentials.refreshToken;
}

/**
 * Simulates the DB query filtering: provider must match id, userId,
 * domain='storage', status='active'.
 */
function queryProvider(
  allProviders: ProviderRow[],
  providerId: string,
  userId: string
): ProviderRow[] {
  return allProviders.filter(
    (p) =>
      p.id === providerId && p.userId === userId && p.domain === 'storage' && p.status === 'active'
  );
}

describe('createSheetsServiceForProvider', () => {
  const activeProvider: ProviderRow = {
    id: 'prov-1',
    userId: 'user-1',
    domain: 'storage',
    status: 'active',
    credentials: 'encrypted-json',
  };

  const allProviders = [activeProvider];

  test('correct token extraction — returns decrypted refreshToken', () => {
    const rows = queryProvider(allProviders, 'prov-1', 'user-1');
    const token = extractRefreshToken(rows, () =>
      JSON.stringify({ refreshToken: 'my-refresh-token' })
    );
    expect(token).toBe('my-refresh-token');
  });

  test('provider not found — throws NotFoundError when no matching row', () => {
    const rows = queryProvider(allProviders, 'prov-missing', 'user-1');
    expect(() => extractRefreshToken(rows, () => '{}')).toThrow('Provider not found');
  });

  test('missing token — throws ValidationError when refreshToken is absent', () => {
    const rows = queryProvider(allProviders, 'prov-1', 'user-1');
    expect(() => extractRefreshToken(rows, () => JSON.stringify({}))).toThrow(
      'Provider has no refresh token'
    );
  });

  test('ownership rejection — different userId returns no rows', () => {
    const rows = queryProvider(allProviders, 'prov-1', 'user-other');
    expect(rows).toHaveLength(0);
    expect(() => extractRefreshToken(rows, () => '{}')).toThrow('Provider not found');
  });

  test('decrypt failure — throws ValidationError', () => {
    const rows = queryProvider(allProviders, 'prov-1', 'user-1');
    expect(() =>
      extractRefreshToken(rows, () => {
        throw new Error('Decryption failed');
      })
    ).toThrow('Failed to decrypt provider credentials');
  });

  test('inactive provider — filtered out by query', () => {
    const inactiveProvider: ProviderRow = {
      ...activeProvider,
      id: 'prov-inactive',
      status: 'inactive',
    };
    const rows = queryProvider([inactiveProvider], 'prov-inactive', 'user-1');
    expect(rows).toHaveLength(0);
  });

  test('wrong domain — filtered out by query', () => {
    const wrongDomain: ProviderRow = {
      ...activeProvider,
      id: 'prov-wrong',
      domain: 'analytics',
    };
    const rows = queryProvider([wrongDomain], 'prov-wrong', 'user-1');
    expect(rows).toHaveLength(0);
  });
});
