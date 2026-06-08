/**
 * Trusted client-IP resolution for rate limiting.
 *
 * SECURITY: `X-Forwarded-For` / `X-Real-IP` are client-controlled headers. Keying
 * a rate limiter on them unconditionally lets an attacker send a unique value per
 * request and get a fresh bucket every time — trivially bypassing the limit (e.g.
 * the auth brute-force limiter). So we derive the client IP from the REAL socket
 * address (Bun's `server.requestIP()` via hono/bun `getConnInfo`) and only honor
 * `X-Forwarded-For` when the request actually arrived from a configured trusted
 * proxy (CONFIG.rateLimit.trustedProxyIps, env TRUSTED_PROXY_IPS). With no trusted
 * proxies configured (the default), forwarded headers are ignored entirely.
 */

import { getConnInfo } from 'hono/bun';
import type { Context } from 'hono';
import { CONFIG } from '../config';

/** The socket peer IP, or undefined when unavailable (e.g. in-process `app.request()`). */
export function getSocketIp(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    // getConnInfo throws when the Bun server isn't in c.env (in-process tests).
    return undefined;
  }
}

/**
 * Parse the original client IP from an `X-Forwarded-For` header. The LEFTMOST
 * entry is the original client; subsequent entries are proxies. We only call this
 * when the immediate peer is a trusted proxy, so the leftmost value is as
 * trustworthy as that proxy's own forwarding.
 */
function clientFromForwardedFor(xff: string): string | undefined {
  const first = xff.split(',')[0]?.trim();
  return first || undefined;
}

/**
 * Resolve the effective client IP for rate-limit keying.
 *
 * - Trusted-proxy deployments: set TRUSTED_PROXY_IPS to your LB/proxy IP(s); when a
 *   request's socket IP matches, the leftmost `X-Forwarded-For` entry is used.
 * - Direct-exposure (default): forwarded headers are ignored; the socket IP is used.
 * - In-process tests (no socket IP): falls back to a forwarded header if present
 *   (tests opt in explicitly), else 'unknown'.
 */
export function getClientIp(c: Context, trustedProxyIps?: readonly string[]): string {
  const socketIp = getSocketIp(c);
  const trusted = trustedProxyIps ?? CONFIG.rateLimit.trustedProxyIps;

  if (socketIp && trusted.includes(socketIp)) {
    const xff = c.req.header('x-forwarded-for');
    const forwarded = xff ? clientFromForwardedFor(xff) : undefined;
    if (forwarded) return forwarded;
  }

  if (socketIp) return socketIp;

  // No socket IP (in-process app.request()). Tests may set a forwarded header to
  // exercise per-IP keying; production always has a socket IP so never reaches here.
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}
