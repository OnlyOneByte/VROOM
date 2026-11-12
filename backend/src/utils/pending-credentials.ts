const TTL_MS = 10 * 60 * 1000;
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

function cleanupExpired(): void {
  for (const [key, entry] of pendingProviderCredentials.entries()) {
    if (isExpired(entry)) {
      pendingProviderCredentials.delete(key);
    }
  }
}

export function storePending(
  userId: string,
  nonce: string,
  refreshToken: string,
  email: string
): void {
  cleanupExpired();

  if (pendingProviderCredentials.size >= MAX_SIZE) {
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

export function getPendingEmail(userId: string, nonce: string): string | null {
  const entry = pendingProviderCredentials.get(makeKey(userId, nonce));
  if (!entry || isExpired(entry)) {
    return null;
  }
  return entry.email;
}

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

export { pendingProviderCredentials };
