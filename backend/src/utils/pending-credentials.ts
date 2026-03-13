/**
 * Temporary in-memory store for provider OAuth credentials between
 * the callback and provider creation.
 *
 * Key format: `userId:nonce`
 * TTL: 10 minutes
 * Max size: 1000 entries (oldest-eviction)
 */

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_SIZE = 1000;

interface PendingCredential {
  refreshToken: string;
  email: string;
  createdAt: number;
}

const pendingProviderCredentials = new Map<string, PendingCredential>();

function makeKey(userId: string, nonce: string): string {
  return `${userId}:${nonce}`;
}

function isExpired(entry: PendingCredential): boolean {
  return Date.now() - entry.createdAt > TTL_MS;
}

/**
 * Remove all entries older than TTL.
 */
export function cleanupExpired(): void {
  for (const [key, entry] of pendingProviderCredentials.entries()) {
    if (isExpired(entry)) {
      pendingProviderCredentials.delete(key);
    }
  }
}

/**
 * Store pending provider credentials. Evicts the oldest entry if at max capacity.
 */
export function storePending(
  userId: string,
  nonce: string,
  refreshToken: string,
  email: string
): void {
  cleanupExpired();

  if (pendingProviderCredentials.size >= MAX_SIZE) {
    // Evict oldest entry — Map iterates in insertion order
    const oldestKey = pendingProviderCredentials.keys().next().value;
    if (oldestKey !== undefined) {
      pendingProviderCredentials.delete(oldestKey);
    }
  }

  pendingProviderCredentials.set(makeKey(userId, nonce), {
    refreshToken,
    email,
    createdAt: Date.now(),
  });
}

/**
 * Return the email for a pending credential if found and not expired.
 * Does NOT consume the entry.
 */
export function getPendingEmail(userId: string, nonce: string): string | null {
  const entry = pendingProviderCredentials.get(makeKey(userId, nonce));
  if (!entry || isExpired(entry)) {
    return null;
  }
  return entry.email;
}

/**
 * Return `{ refreshToken, email }` if found and not expired, then delete the entry.
 * Returns null if not found or expired.
 */
export function consumePending(
  userId: string,
  nonce: string
): { refreshToken: string; email: string } | null {
  const key = makeKey(userId, nonce);
  const entry = pendingProviderCredentials.get(key);
  if (!entry || isExpired(entry)) {
    if (entry) pendingProviderCredentials.delete(key);
    return null;
  }
  pendingProviderCredentials.delete(key);
  return { refreshToken: entry.refreshToken, email: entry.email };
}

/** Exposed for testing only. */
export { pendingProviderCredentials };
