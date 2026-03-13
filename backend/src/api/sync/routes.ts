/**
 * Sync Routes - Backup, restore, and sync operations
 */

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { getDb } from '../../db/connection';
import { userProviders } from '../../db/schema';
import {
  createErrorResponse,
  createSuccessResponse,
  handleSyncError,
  SyncError,
  SyncErrorCode,
} from '../../errors';
import { bodyLimit, idempotency, rateLimiter, requireAuth } from '../../middleware';
import type { BackupConfig, ProviderBackupSettings } from '../../types';
import { OPERATION_TIMEOUTS, withTimeout } from '../../utils/timeout';
import { settingsRepository } from '../settings/repository';
import { activityTracker } from './activity-tracker';
import { backupService } from './backup';
import { backupOrchestrator } from './backup-orchestrator';
import './init';
import { restoreService } from './restore';

const routes = new Hono();

routes.use('*', requireAuth);

const syncRateLimiter = rateLimiter({
  ...CONFIG.rateLimit.sync,
  keyGenerator: (c) => `sync:${c.get('user').id}`,
});
const backupRateLimiter = rateLimiter({
  ...CONFIG.rateLimit.backup,
  keyGenerator: (c) => `backup:${c.get('user').id}`,
});
const restoreRateLimiter = rateLimiter({
  ...CONFIG.rateLimit.restore,
  keyGenerator: (c) => `restore:${c.get('user').id}`,
});

// --- Zod schemas ---

const restoreFromProviderSchema = z.discriminatedUnion('sourceType', [
  z.object({
    sourceType: z.literal('zip'),
    providerId: z.string().min(1).max(64),
    fileRef: z.string().min(1).max(1024),
    mode: z.enum(['preview', 'replace', 'merge']),
  }),
  z.object({
    sourceType: z.literal('sheets'),
    providerId: z.string().min(1).max(64),
    mode: z.enum(['preview', 'replace', 'merge']),
  }),
]);

// --- Route handlers ---

routes.get('/health', async (c) => {
  return c.json({ status: 'healthy', timestamp: new Date().toISOString(), service: 'sync' });
});

function validateSyncTypes(syncTypes: unknown): string[] {
  if (!syncTypes || !Array.isArray(syncTypes) || syncTypes.length === 0) {
    throw new SyncError(SyncErrorCode.VALIDATION_ERROR, 'syncTypes must be a non-empty array');
  }

  const validSyncTypes = ['backup'];
  const invalidTypes = syncTypes.filter((type: string) => !validSyncTypes.includes(type));
  if (invalidTypes.length > 0) {
    throw new SyncError(
      SyncErrorCode.VALIDATION_ERROR,
      `Invalid sync types: ${invalidTypes.join(', ')}`
    );
  }

  return syncTypes as string[];
}

routes.post('/', syncRateLimiter, idempotency({ required: false }), async (c) => {
  const user = c.get('user');
  const userId = user.id;

  try {
    const body = await c.req.json();
    validateSyncTypes(body.syncTypes);
    const force = body.force === true;

    const result = await backupOrchestrator.execute(userId, user.displayName, force);

    if (result.status === 'in_progress') {
      return c.json(
        createErrorResponse('BACKUP_IN_PROGRESS', 'A backup is already in progress'),
        409
      );
    }

    return c.json(createSuccessResponse(result, 'Sync completed'));
  } catch (error) {
    return handleSyncError(c, error, 'sync');
  }
});

routes.get('/status', async (c) => {
  const user = c.get('user');
  try {
    const settings = await settingsRepository.getOrCreate(user.id);
    const syncStatus = activityTracker.getSyncStatus(user.id);

    // Derive backup/sheets status from backupConfig
    const config = settings.backupConfig as BackupConfig | null;
    const providers = config?.providers;
    const backupEnabled = providers ? Object.values(providers).some((p) => p.enabled) : false;
    const sheetsSyncEnabled = providers
      ? Object.values(providers).some((p) => p.sheetsSyncEnabled)
      : false;

    return c.json(
      createSuccessResponse({
        backupEnabled,
        sheetsSyncEnabled,
        syncOnInactivity: settings.syncOnInactivity,
        syncInactivityMinutes: settings.syncInactivityMinutes,
        lastSyncDate: settings.lastSyncDate,
        lastBackupDate: settings.lastBackupDate,
        lastDataChangeDate: settings.lastDataChangeDate,
        ...syncStatus,
      })
    );
  } catch (error) {
    return handleSyncError(c, error, 'get sync status');
  }
});

routes.get('/backups/providers', async (c) => {
  const user = c.get('user');
  try {
    const providerId = c.req.query('providerId');

    if (providerId) {
      const backups = await backupService.listBackups(user.id, providerId);
      return c.json(createSuccessResponse(backups));
    }

    const allBackups = await backupService.listAllBackups(user.id);
    return c.json(createSuccessResponse(allBackups));
  } catch (error) {
    return handleSyncError(c, error, 'list backups from providers');
  }
});

routes.get('/backups/download', backupRateLimiter, async (c) => {
  const user = c.get('user');
  try {
    const zipBuffer = await withTimeout(
      backupService.exportAsZip(user.id),
      OPERATION_TIMEOUTS.BACKUP,
      'Backup export'
    );
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return new Response(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="vroom-backup-${timestamp}.zip"`,
        'Content-Length': zipBuffer.length.toString(),
      },
    });
  } catch (error) {
    return handleSyncError(c, error, 'download backup');
  }
});

routes.post(
  '/restore/from-provider',
  restoreRateLimiter,
  idempotency({ required: true }),
  async (c) => {
    const user = c.get('user');
    try {
      const body = restoreFromProviderSchema.parse(await c.req.json());

      // Verify provider exists and is active
      const db = getDb();
      const providerRow = await db
        .select()
        .from(userProviders)
        .where(
          and(
            eq(userProviders.id, body.providerId),
            eq(userProviders.userId, user.id),
            eq(userProviders.status, 'active')
          )
        )
        .limit(1);

      if (!providerRow[0]) {
        throw new SyncError(SyncErrorCode.VALIDATION_ERROR, 'Provider not found or inactive');
      }

      let result: import('./restore').RestoreResponse;
      if (body.sourceType === 'zip') {
        const zipBuffer = await withTimeout(
          backupService.downloadBackup(user.id, body.providerId, body.fileRef),
          OPERATION_TIMEOUTS.RESTORE,
          'Download backup from provider'
        );
        result = await withTimeout(
          restoreService.restoreFromBackup(user.id, zipBuffer, body.mode),
          OPERATION_TIMEOUTS.RESTORE,
          'Restore from provider backup'
        );
      } else {
        result = await withTimeout(
          restoreService.restoreFromSheets(user.id, body.providerId, body.mode),
          OPERATION_TIMEOUTS.RESTORE,
          'Restore from provider sheets'
        );
      }

      return c.json(createSuccessResponse(result, 'Restore operation completed'));
    } catch (error) {
      return handleSyncError(c, error, 'restore from provider');
    }
  }
);

routes.post(
  '/restore/from-backup',
  restoreRateLimiter,
  bodyLimit({ maxSize: CONFIG.backup.maxFileSize }),
  idempotency({ required: true }),
  async (c) => {
    const user = c.get('user');
    try {
      const formData = await c.req.formData();
      const file = formData.get('file') as File | null;
      const mode = (formData.get('mode') as string) || 'preview';

      if (!file) {
        throw new SyncError(SyncErrorCode.VALIDATION_ERROR, 'No file provided');
      }

      if (!CONFIG.backup.supportedModes.includes(mode as never)) {
        throw new SyncError(
          SyncErrorCode.VALIDATION_ERROR,
          `Invalid mode. Supported: ${CONFIG.backup.supportedModes.join(', ')}`
        );
      }

      const fileBuffer = Buffer.from(await file.arrayBuffer());
      const sizeValidation = backupService.validateFileSize(fileBuffer.length);
      if (!sizeValidation.valid) {
        throw new SyncError(SyncErrorCode.VALIDATION_ERROR, sizeValidation.errors[0]);
      }

      const result = await withTimeout(
        restoreService.restoreFromBackup(
          user.id,
          fileBuffer,
          mode as 'preview' | 'merge' | 'replace'
        ),
        OPERATION_TIMEOUTS.RESTORE,
        'Restore from backup'
      );
      return c.json(createSuccessResponse(result, 'Restore operation completed'));
    } catch (error) {
      return handleSyncError(c, error, 'restore from backup');
    }
  }
);

interface RestoreProviderInfo {
  providerId: string;
  providerType: string;
  displayName: string;
  accountEmail: string;
  sourceTypes: ('zip' | 'sheets')[];
}

routes.get('/restore/providers', syncRateLimiter, async (c) => {
  const user = c.get('user');
  try {
    const db = getDb();
    const providers = await db
      .select()
      .from(userProviders)
      .where(
        and(
          eq(userProviders.userId, user.id),
          eq(userProviders.domain, 'storage'),
          eq(userProviders.status, 'active')
        )
      );

    const settings = await settingsRepository.getOrCreate(user.id);
    const config: BackupConfig = (settings.backupConfig as BackupConfig | null) ?? {
      providers: {},
    };

    const restoreProviders: RestoreProviderInfo[] = [];

    for (const provider of providers) {
      const providerConfig: ProviderBackupSettings | undefined = config.providers[provider.id];
      if (!providerConfig) continue;

      const sourceTypes: ('zip' | 'sheets')[] = [];

      if (providerConfig.enabled && providerConfig.lastBackupAt) {
        sourceTypes.push('zip');
      }
      if (providerConfig.sheetsSyncEnabled && providerConfig.sheetsSpreadsheetId) {
        sourceTypes.push('sheets');
      }

      if (sourceTypes.length === 0) continue;

      const providerConfigJson = provider.config as Record<string, unknown> | null;

      restoreProviders.push({
        providerId: provider.id,
        providerType: provider.providerType,
        displayName: provider.displayName,
        accountEmail: (providerConfigJson?.accountEmail as string) ?? '',
        sourceTypes,
      });
    }

    return c.json(createSuccessResponse(restoreProviders));
  } catch (error) {
    return handleSyncError(c, error, 'list restore providers');
  }
});

export { routes };
