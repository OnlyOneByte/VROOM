import { and, eq, lte } from 'drizzle-orm';
import type { Context } from 'hono';
import { generateIdFromEntropySize } from 'lucia';
import { appContext } from '../../app-context';
import { CONFIG } from '../../config';
import { sessions, users } from '../../db/schema';
import { seedGarage } from '../../db/seed';
import { assignServerRole } from '../../permissions/grants';
import { DEMO_ROLE_KEY } from '../../permissions/roles';
import { extractErrorMessage } from '../../utils/error-handling';
import { logger } from '../../utils/logger';
import { DEMO_USER_ID } from './demo-account';
import { DEMO_SESSION_PREFIX, demoSessionExpiresAt, setSessionCookie } from './utils';

export { DEMO_USER_ID };

const DEMO_USER_EMAIL = 'demo-garage@vroom.invalid';

let demoReady = false;

export function isDemoAvailable(): boolean {
  return CONFIG.demo.enabled && demoReady;
}

export async function prepareDemoGarage(): Promise<void> {
  const { db, asyncDb } = appContext();
  demoReady = false;
  await asyncDb.delete(users).where(eq(users.id, DEMO_USER_ID));
  if (!CONFIG.demo.enabled) return;
  try {
    await asyncDb
      .insert(users)
      .values({ id: DEMO_USER_ID, email: DEMO_USER_EMAIL, displayName: 'Demo Garage' });
    assignServerRole(db, DEMO_USER_ID, DEMO_ROLE_KEY);
    await seedGarage(DEMO_USER_ID);
  } catch (error) {
    await asyncDb
      .delete(users)
      .where(eq(users.id, DEMO_USER_ID))
      .catch((cleanupError: unknown) =>
        logger.error('Could not remove the partly seeded demo garage', {
          message: extractErrorMessage(cleanupError),
        })
      );
    throw error;
  }
  demoReady = true;
  logger.info('Demo garage is ready');
}

export async function startDemoSession(c: Context): Promise<Date> {
  const now = Date.now();
  await appContext()
    .asyncDb.delete(sessions)
    .where(and(eq(sessions.userId, DEMO_USER_ID), lte(sessions.expiresAt, Math.floor(now / 1000))));
  const sessionId = `${DEMO_SESSION_PREFIX}${now}_${generateIdFromEntropySize(25)}`;
  await appContext().lucia.createSession(DEMO_USER_ID, {}, { sessionId });
  const expiresAt = demoSessionExpiresAt(sessionId) as Date;
  setSessionCookie(c, appContext().lucia.sessionCookieName, { id: sessionId, expiresAt });
  return expiresAt;
}
