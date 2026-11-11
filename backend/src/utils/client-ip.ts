// X-Forwarded-For is client-controlled. Honour it only when the socket peer is a trusted proxy, or
// a rate limiter keyed on it can be bypassed by sending a fresh value per request.

import type { Context } from 'hono';
import { getConnInfo } from 'hono/bun';
import { CONFIG } from '../config';

export function getSocketIp(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    // Throws when the Bun server is not in c.env, as in in-process tests.
    return undefined;
  }
}

// The leftmost entry is the original client; later entries are proxies.
function clientFromForwardedFor(xff: string): string | undefined {
  const first = xff.split(',')[0]?.trim();
  return first || undefined;
}

export function getClientIp(c: Context, trustedProxyIps?: readonly string[]): string {
  const socketIp = getSocketIp(c);
  const trusted = trustedProxyIps ?? CONFIG.rateLimit.trustedProxyIps;

  if (socketIp && trusted.includes(socketIp)) {
    const xff = c.req.header('x-forwarded-for');
    const forwarded = xff ? clientFromForwardedFor(xff) : undefined;
    if (forwarded) return forwarded;
  }

  if (socketIp) return socketIp;

  // Only in-process tests reach this branch; they set the header to exercise per-IP keying.
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}
