import type { Context, MiddlewareHandler, Next } from 'hono';
import { preferencesRepository } from '../api/settings/repository';
import { activityTracker as userActivityTracker } from '../api/sync/activity-tracker';
import { filterEnabledProviders } from '../api/sync/backup-orchestrator';
import type { BackupConfig } from '../types';
import { logger } from '../utils/logger';

export const activityTracker: MiddlewareHandler = async (c, next) => {
  await next();

  const user = c.get('user');
  if (!user) return;

  try {
    const path = c.req.path;
    const method = c.req.method;
    const shouldTrack =
      (path.startsWith('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) ||
      path.startsWith('/auth/');

    if (!shouldTrack) return;

    const settings = await preferencesRepository.getOrCreate(user.id);
    const backupConfig = settings.backupConfig as BackupConfig | null;
    const hasSyncEnabled = backupConfig?.providers
      ? filterEnabledProviders(backupConfig).length > 0
      : false;
    if (settings.syncOnInactivity && hasSyncEnabled) {
      userActivityTracker.recordActivity(user.id, settings.syncInactivityMinutes);
    }
  } catch (error) {
    logger.error('Activity tracking failed', { userId: user.id, error });
  }
};

export async function changeTracker(c: Context, next: Next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
    return next();
  }

  await next();

  if (c.res.status >= 200 && c.res.status < 300) {
    const user = c.get('user');
    if (user?.id) {
      userActivityTracker.markDataChanged(user.id).catch((error) => {
        logger.error('Failed to mark data changed', { userId: user.id, error });
      });
    }
  }
}
