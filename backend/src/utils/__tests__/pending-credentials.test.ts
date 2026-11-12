import { beforeEach, describe, expect, test } from 'bun:test';
import {
  consumePending,
  getPendingEmail,
  pendingProviderCredentials,
  storePending,
} from '../pending-credentials';

const TTL_MS = 10 * 60 * 1000;

beforeEach(() => {
  pendingProviderCredentials.clear();
});

function backdateBeyondTtl(userId: string, nonce: string): void {
  const entry = pendingProviderCredentials.get(`${userId}:${nonce}`);
  if (entry) entry.createdAt = Date.now() - (TTL_MS + 1000);
}

describe('storePending / consumePending — happy path + consume-once', () => {
  test('stores then consumes exactly once (second consume is null)', () => {
    storePending('u1', 'n1', 'refresh-tok', 'a@example.com');
    expect(consumePending('u1', 'n1')).toEqual({
      refreshToken: 'refresh-tok',
      email: 'a@example.com',
    });
    expect(consumePending('u1', 'n1')).toBeNull();
  });

  test('consume is scoped to the (userId, nonce) key — a different user/nonce misses', () => {
    storePending('u1', 'n1', 'tok', 'a@example.com');
    expect(consumePending('u2', 'n1')).toBeNull();
    expect(consumePending('u1', 'n2')).toBeNull();
    expect(consumePending('u1', 'n1')).not.toBeNull();
  });
});

describe('TTL expiry', () => {
  test('getPendingEmail returns the email while fresh, null once expired', () => {
    storePending('u1', 'n1', 'tok', 'fresh@example.com');
    expect(getPendingEmail('u1', 'n1')).toBe('fresh@example.com');
    backdateBeyondTtl('u1', 'n1');
    expect(getPendingEmail('u1', 'n1')).toBeNull();
  });

  test('getPendingEmail returns null for an unknown key', () => {
    expect(getPendingEmail('nobody', 'nope')).toBeNull();
  });

  test('consumePending returns null for an expired entry AND deletes it', () => {
    storePending('u1', 'n1', 'tok', 'e@example.com');
    backdateBeyondTtl('u1', 'n1');
    expect(consumePending('u1', 'n1')).toBeNull();
    expect(pendingProviderCredentials.has('u1:n1')).toBe(false);
  });

  test('a fresh storePending cleans up other expired entries', () => {
    storePending('old', 'n', 'tok', 'old@example.com');
    backdateBeyondTtl('old', 'n');
    storePending('new', 'n', 'tok2', 'new@example.com');
    expect(pendingProviderCredentials.has('old:n')).toBe(false);
    expect(pendingProviderCredentials.has('new:n')).toBe(true);
  });
});

describe('max-size eviction', () => {
  test('a fresh entry stays retrievable right after it is stored', () => {
    storePending('u1', 'n1', 'tok', 'e@example.com');
    expect(getPendingEmail('u1', 'n1')).toBe('e@example.com');
    expect(pendingProviderCredentials.size).toBe(1);
  });

  test('at MAX_SIZE, storing one more evicts the OLDEST entry and holds the cap', () => {
    const MAX_SIZE = 1000;
    for (let i = 0; i < MAX_SIZE; i++) {
      storePending(`user-${i}`, 'n', `tok-${i}`, `e${i}@example.com`);
    }
    expect(pendingProviderCredentials.size).toBe(MAX_SIZE);
    expect(pendingProviderCredentials.has('user-0:n')).toBe(true);

    storePending('newcomer', 'n', 'tok-new', 'new@example.com');

    expect(pendingProviderCredentials.size).toBe(MAX_SIZE);
    expect(pendingProviderCredentials.has('user-0:n')).toBe(false);
    expect(getPendingEmail('newcomer', 'n')).toBe('new@example.com');
    expect(pendingProviderCredentials.has('user-1:n')).toBe(true);
  });
});
