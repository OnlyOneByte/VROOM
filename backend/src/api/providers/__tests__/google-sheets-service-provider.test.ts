import { describe, expect, test } from 'bun:test';
import type { UserProvider } from '../../../db/schema';
import { decryptRefreshToken } from '../domains/storage/registry';

process.env.PROVIDER_ENCRYPTION_KEY ||= '0'.repeat(64);
const { encrypt } = await import('../../../utils/encryption');

const ROW = { id: 'prov-1', userId: 'user-1', domain: 'storage' };
const enc = (creds: unknown): string =>
  encrypt(JSON.stringify(creds), { rowId: ROW.id, userId: ROW.userId, domain: ROW.domain });
const row = (credentials: string) => ({ ...ROW, credentials }) as UserProvider;

interface ProviderRow {
  id: string;
  userId: string;
  domain: string;
  status: string;
  credentials: string;
}

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
    expect(decryptRefreshToken(row(enc({ refreshToken: 'my-refresh-token' })))).toBe(
      'my-refresh-token'
    );
  });

  test('ownership rejection — different userId returns no rows', () => {
    const rows = queryProvider(allProviders, 'prov-1', 'user-other');
    expect(rows).toHaveLength(0);
  });

  test('missing token — throws ValidationError when refreshToken is absent', () => {
    expect(() => decryptRefreshToken(row(enc({})))).toThrow('Provider has no refresh token');
    expect(() => decryptRefreshToken(row(enc({ refreshToken: '' })))).toThrow(
      'Provider has no refresh token'
    );
  });

  test('decrypt failure — throws ValidationError', () => {
    expect(() => decryptRefreshToken(row('not-encrypted'))).toThrow(
      'Failed to decrypt provider credentials'
    );
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
