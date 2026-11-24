import { eq } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { generateIdFromEntropySize } from 'lucia';
import { CONFIG } from '../../config';
import { getDb } from '../../db/connection';
import { sessions, users } from '../../db/schema';
import { seedGarage } from '../../db/seed';
import { DemoReadOnlyError } from '../../errors';
import { logger } from '../../utils/logger';
import { lucia } from './lucia';
import { DEMO_SESSION_PREFIX, demoSessionExpiresAt, setSessionCookie } from './utils';

export const DEMO_USER_ID = 'demo-garage';
const DEMO_USER_EMAIL = 'demo-garage@vroom.invalid';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SESSION_WRITES = new Set(['POST /api/v1/auth/logout', 'POST /api/v1/auth/refresh']);
const CLOSED_PREFIXES = [
  '/api/v1/assistant',
  '/api/v1/auth/accounts',
  '/api/v1/auth/callback/link',
  '/api/v1/auth/callback/provider',
  '/api/v1/auth/link',
  '/api/v1/auth/providers/connect',
  '/api/v1/expenses/export',
  '/api/v1/providers',
  '/api/v1/push',
  '/api/v1/receipts',
  '/api/v1/shares',
  '/api/v1/sync',
];

let demoReady = false;

export function isDemoAvailable(): boolean {
  return CONFIG.demo.enabled && demoReady;
}

export async function prepareDemoGarage(): Promise<void> {
  const db = getDb();
  demoReady = false;
  await db.delete(users).where(eq(users.id, DEMO_USER_ID));
  if (!CONFIG.demo.enabled) return;
  await db
    .insert(users)
    .values({ id: DEMO_USER_ID, email: DEMO_USER_EMAIL, displayName: 'Demo Garage' });
  await seedGarage(DEMO_USER_ID);
  demoReady = true;
  logger.info('Demo garage is ready');
}

export async function startDemoSession(c: Context): Promise<Date> {
  const sessionId = `${DEMO_SESSION_PREFIX}${Date.now()}_${generateIdFromEntropySize(25)}`;
  await lucia.createSession(DEMO_USER_ID, {}, { sessionId });
  const expiresAt = demoSessionExpiresAt(sessionId) as Date;
  await getDb()
    .update(sessions)
    .set({ expiresAt: Math.floor(expiresAt.getTime() / 1000) })
    .where(eq(sessions.id, sessionId));
  setSessionCookie(c, lucia.sessionCookieName, { id: sessionId, expiresAt });
  return expiresAt;
}

function canonicalPath(path: string): string {
  const lower = path.toLowerCase().replace(/\/{2,}/g, '/');
  return lower.startsWith('/api/v1/') ? lower : lower.replace(/^\/api\//, '/api/v1/');
}

export function demoMayRequest(method: string, path: string): boolean {
  const route = canonicalPath(path);
  if (SESSION_WRITES.has(`${method} ${route}`)) return true;
  if (!READ_METHODS.has(method)) return false;
  return !CLOSED_PREFIXES.some((prefix) => route === prefix || route.startsWith(`${prefix}/`));
}

export const demoGuard: MiddlewareHandler = async (c, next) => {
  if (c.get('user')?.id !== DEMO_USER_ID) return next();
  if (!demoMayRequest(c.req.method, c.req.path)) throw new DemoReadOnlyError();
  return next();
};
