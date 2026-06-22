/**
 * Unit tests for the pending-OAuth-credentials store (C83 guard, steered by the C81 coverage
 * baseline — this security-relevant module was ~76% covered, the gaps being the TTL-expiry and
 * max-size-eviction edge cases). It stages a provider refresh token between the OAuth callback
 * and provider creation, so its TTL + consume-once + capacity-eviction semantics are a real
 * security contract: a credential must NOT outlive its 10-min window, must be consumable exactly
 * once, and the store must not grow unbounded.
 *
 * The auth property test already covers the happy store→consume→consume-again-null path; this
 * pins the UNCOVERED branches. Expiry is made deterministic by back-dating an entry's `createdAt`
 * via the test-only exposed Map (no timers, no Date mocking).
 */

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

/** Force the stored entry for (userId, nonce) to look older than the TTL. */
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
    expect(consumePending('u1', 'n1')).toBeNull(); // already consumed → gone
  });

  test('consume is scoped to the (userId, nonce) key — a different user/nonce misses', () => {
    storePending('u1', 'n1', 'tok', 'a@example.com');
    expect(consumePending('u2', 'n1')).toBeNull();
    expect(consumePending('u1', 'n2')).toBeNull();
    // The real entry is untouched by the misses and still consumable.
    expect(consumePending('u1', 'n1')).not.toBeNull();
  });
});

describe('TTL expiry (the uncovered isExpired branches)', () => {
  test('getPendingEmail returns the email while fresh, null once expired', () => {
    storePending('u1', 'n1', 'tok', 'fresh@example.com');
    expect(getPendingEmail('u1', 'n1')).toBe('fresh@example.com');
    backdateBeyondTtl('u1', 'n1');
    expect(getPendingEmail('u1', 'n1')).toBeNull(); // past TTL → not returned
  });

  test('getPendingEmail returns null for an unknown key', () => {
    expect(getPendingEmail('nobody', 'nope')).toBeNull();
  });

  test('consumePending returns null for an expired entry AND deletes it', () => {
    storePending('u1', 'n1', 'tok', 'e@example.com');
    backdateBeyondTtl('u1', 'n1');
    expect(consumePending('u1', 'n1')).toBeNull(); // expired → not handed out
    expect(pendingProviderCredentials.has('u1:n1')).toBe(false); // and purged
  });

  test('a fresh storePending cleans up other expired entries (cleanupExpired)', () => {
    storePending('old', 'n', 'tok', 'old@example.com');
    backdateBeyondTtl('old', 'n');
    // Storing a NEW entry triggers cleanupExpired(), which should evict the stale one.
    storePending('new', 'n', 'tok2', 'new@example.com');
    expect(pendingProviderCredentials.has('old:n')).toBe(false);
    expect(pendingProviderCredentials.has('new:n')).toBe(true);
  });
});

describe('max-size eviction (the uncovered capacity branch)', () => {
  test('a fresh entry stays retrievable; the store does not drop the just-stored key', () => {
    // Light functional check of the store-then-retrieve invariant the eviction path must preserve.
    storePending('u1', 'n1', 'tok', 'e@example.com');
    expect(getPendingEmail('u1', 'n1')).toBe('e@example.com');
    expect(pendingProviderCredentials.size).toBe(1);
  });

  // The capacity branch (storePending lines 53-56) was UNCOVERED: the prior test only stored ONE
  // entry, never reaching MAX_SIZE. This is a DoS-prevention contract — abandoned OAuth flows must
  // not grow the in-memory store unbounded; at capacity the OLDEST (insertion-order) entry is evicted.
  test('at MAX_SIZE, storing one more evicts the OLDEST entry and holds the cap', () => {
    const MAX_SIZE = 1000;
    // Fill exactly to capacity. Fresh entries, so cleanupExpired() drops none.
    for (let i = 0; i < MAX_SIZE; i++) {
      storePending(`user-${i}`, 'n', `tok-${i}`, `e${i}@example.com`);
    }
    expect(pendingProviderCredentials.size).toBe(MAX_SIZE);
    expect(pendingProviderCredentials.has('user-0:n')).toBe(true); // oldest present

    // One more push trips the eviction branch.
    storePending('newcomer', 'n', 'tok-new', 'new@example.com');

    // The cap holds (no unbounded growth), the oldest was evicted, the newest is present.
    expect(pendingProviderCredentials.size).toBe(MAX_SIZE);
    expect(pendingProviderCredentials.has('user-0:n')).toBe(false); // oldest evicted
    expect(getPendingEmail('newcomer', 'n')).toBe('new@example.com'); // newest retained
    // only ONE eviction per over-cap insert → the second-oldest survived
    expect(pendingProviderCredentials.has('user-1:n')).toBe(true);
  });
});
