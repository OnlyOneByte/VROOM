// X-Forwarded-For is client-controlled: honor it only from trusted proxy sockets, or a limiter keyed on it is bypassable.

import type { Context } from 'hono';
import { getConnInfo } from 'hono/bun';
import { CONFIG } from '../config';

function getSocketIp(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

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

  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}
