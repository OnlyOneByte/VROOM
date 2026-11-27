import { and, eq, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { appContext, repos } from '../../app-context';
import { CONFIG } from '../../config';
import { userProviders } from '../../db/schema';
import { createErrorResponse, createSuccessResponse, ValidationError } from '../../errors';
import {
  bodyLimit,
  heavyJobLimiter,
  idempotency,
  rateLimiter,
  requireAuth,
} from '../../middleware';
import { authorize, ownAccount } from '../../permissions/authorize';
import type { BackupConfig, ProviderBackupSettings } from '../../types';
import { readJsonBody } from '../../utils/request-body';
import { OPERATION_TIMEOUTS, withDeadline, withTimeout } from '../../utils/timeout';
import { zValidator } from '../../utils/validation';
import { activityTracker } from './activity-tracker';
import { backupService } from './backup';
import { backupOrchestrator, loadProviderTypes } from './backup-orchestrator';
import {
  hasSheetsSync,
  hasZipBackup,
  isPhotoOnlyProviderType,
  isSyncEnabled,
} from './backup-strategy';
import './init';
import { type RestoreResponse, restoreService } from './restore';

const routes = new Hono();

const UNHEALTHY_PROVIDER_STATUSES: ReadonlySet<string> = new Set(['needs_reauth', 'error']);

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

export const restoreFromProviderSchema = z.discriminatedUnion('sourceType', [
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

function validateSyncTypes(syncTypes: unknown): string[] {
  if (!syncTypes || !Array.isArray(syncTypes) || syncTypes.length === 0) {
    throw new ValidationError('syncTypes must be a non-empty array');
  }

  const validSyncTypes = ['backup'];
  const invalidTypes = syncTypes.filter((type: string) => !validSyncTypes.includes(type));
  if (invalidTypes.length > 0) {
    throw new ValidationError(`Invalid sync types: ${invalidTypes.join(', ')}`);
  }

  return syncTypes as string[];
}

const providerIdsSchema = z
  .array(z.string().min(1).max(64))
  .min(1, 'Choose at least one provider')
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, 'Provider ids must be unique')
  .optional();

async function validateProviderIds(userId: string, raw: unknown): Promise<string[] | undefined> {
  const parsed = providerIdsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid providerIds');
  }
  if (!parsed.data) return undefined;
  const types = await loadProviderTypes(userId);
  for (const id of parsed.data) {
    const type = types.get(id);
    if (type === undefined) throw new ValidationError('Unknown storage provider');
    if (isPhotoOnlyProviderType(type)) {
      throw new ValidationError('That storage provider only keeps photos');
    }
  }
  return parsed.data;
}

routes.post(
  '/',
  syncRateLimiter,
  authorize(ownAccount),
  idempotency({ required: false }),
  async (c) => {
    const user = c.get('user');
    const userId = user.id;

    // null parses as valid JSON, so the parsed body can be null and must be optional-chained.
    const body = await readJsonBody<{
      syncTypes?: unknown;
      force?: unknown;
      providerIds?: unknown;
    } | null>(c);
    validateSyncTypes(body?.syncTypes);
    const force = body?.force === true;
    const providerIds = await validateProviderIds(userId, body?.providerIds);

    const result = await backupOrchestrator.execute(userId, user.displayName, force, providerIds);

    if (result.status === 'in_progress') {
      return c.json(
        createErrorResponse('BACKUP_IN_PROGRESS', 'A backup is already in progress'),
        409
      );
    }

    if (result.outcome === 'failed') {
      return c.json(
        createErrorResponse('BACKUP_FAILED', 'All backup providers failed', {
          failedProviders: result.failedProviders,
          results: result.results,
        }),
        502
      );
    }

    const message =
      result.outcome === 'partial'
        ? `Backup partially failed (${result.failedProviders.join(', ')})`
        : 'Sync completed';
    return c.json(createSuccessResponse(result, message), result.outcome === 'partial' ? 207 : 200);
  }
);

routes.post(
  '/sheets/:providerId/resume',
  syncRateLimiter,
  zValidator('param', z.object({ providerId: z.string().min(1).max(64) })),
  authorize(ownAccount),
  async (c) => {
    const userId = c.get('user').id;
    const { providerId } = c.req.valid('param');
    const prefs = await repos().preferences.getOrCreate(userId);
    const config = prefs?.backupConfig as BackupConfig | null;
    if (config?.providers?.[providerId]?.sheetsAutoPausedAt) {
      await repos().preferences.mergeJsonField(userId, 'backupConfig', {
        providers: { [providerId]: { sheetsAutoPausedAt: null } },
      });
    }
    return c.json(createSuccessResponse(undefined, 'Automatic Sheets backups resumed'));
  }
);

routes.get('/status', authorize(ownAccount), async (c) => {
  const user = c.get('user');
  const settings = await repos().preferences.getOrCreate(user.id);
  const syncStatus = activityTracker.getSyncStatus(user.id);
  const syncStateData = await repos().syncState.getOrCreate(user.id);

  const config = settings.backupConfig as BackupConfig | null;
  const providers = config?.providers;
  const providerRows = providers
    ? await appContext()
        .asyncDb.select({
          id: userProviders.id,
          providerType: userProviders.providerType,
          status: userProviders.status,
        })
        .from(userProviders)
        .where(eq(userProviders.userId, user.id))
    : [];
  const providerTypes = new Map(providerRows.map((row) => [row.id, row.providerType]));
  const backupEnabled = providers
    ? Object.entries(providers).some(([id, s]) => hasZipBackup(s, providerTypes.get(id)))
    : false;
  const sheetsSyncEnabled = providers ? Object.values(providers).some(hasSheetsSync) : false;
  const providerNeedsAttention = providerRows.some((row) => {
    const backup = providers?.[row.id];
    return (
      backup !== undefined &&
      UNHEALTHY_PROVIDER_STATUSES.has(row.status) &&
      isSyncEnabled(backup, row.providerType)
    );
  });

  return c.json(
    createSuccessResponse({
      backupEnabled,
      sheetsSyncEnabled,
      providerNeedsAttention,
      syncOnInactivity: settings.syncOnInactivity,
      syncInactivityMinutes: settings.syncInactivityMinutes,
      lastSyncDate: syncStateData.lastSyncDate,
      lastBackupDate: syncStateData.lastBackupDate,
      lastDataChangeDate: syncStateData.lastDataChangeDate,
      ...syncStatus,
    })
  );
});

routes.get('/backups/providers', authorize(ownAccount), async (c) => {
  const user = c.get('user');
  const providerId = c.req.query('providerId');

  if (providerId) {
    const backups = await backupService.listBackups(user.id, providerId);
    return c.json(createSuccessResponse(backups));
  }

  const allBackups = await backupService.listAllBackups(user.id);
  return c.json(createSuccessResponse(allBackups));
});

routes.get('/backups/download', backupRateLimiter, authorize(ownAccount), async (c) => {
  const user = c.get('user');
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
});

routes.post(
  '/restore/from-provider',
  restoreRateLimiter,
  heavyJobLimiter,
  authorize(ownAccount),
  idempotency({ required: true }),
  async (c) => {
    const user = c.get('user');
    const body = restoreFromProviderSchema.parse(await readJsonBody(c));

    const db = appContext().asyncDb;
    const providerRow = await db
      .select()
      .from(userProviders)
      .where(
        and(
          eq(userProviders.id, body.providerId),
          eq(userProviders.userId, user.id),
          ne(userProviders.status, 'disabled')
        )
      )
      .limit(1);

    if (!providerRow[0]) {
      throw new ValidationError('Provider not found or inactive');
    }

    let result: RestoreResponse;
    if (body.sourceType === 'zip') {
      const zipBuffer = await withTimeout(
        backupService.downloadBackup(user.id, body.providerId, body.fileRef),
        OPERATION_TIMEOUTS.RESTORE,
        'Download backup from provider'
      );
      result = await withDeadline(
        (signal) => restoreService.restoreFromBackup(user.id, zipBuffer, body.mode, signal),
        OPERATION_TIMEOUTS.RESTORE,
        'Restore from provider backup'
      );
    } else {
      result = await withDeadline(
        (signal) => restoreService.restoreFromSheets(user.id, body.providerId, body.mode, signal),
        OPERATION_TIMEOUTS.RESTORE,
        'Restore from provider sheets'
      );
    }

    return c.json(createSuccessResponse(result, 'Restore operation completed'));
  }
);

// Full backup ZIPs exceed the app-wide body cap, which app.ts must relax for this path.
routes.post(
  '/restore/from-backup',
  restoreRateLimiter,
  heavyJobLimiter,
  authorize(ownAccount),
  bodyLimit({ maxSize: CONFIG.backup.maxFileSize }),
  idempotency({ required: true }),
  async (c) => {
    const user = c.get('user');
    const formData = await c.req.formData().catch(() => {
      throw new ValidationError('Upload the backup as multipart/form-data with a file field');
    });
    const file = formData.get('file');
    const modeField = formData.get('mode');
    const mode = typeof modeField === 'string' && modeField ? modeField : 'preview';

    if (!(file instanceof File)) {
      throw new ValidationError('No file provided');
    }

    if (!CONFIG.backup.supportedModes.includes(mode as never)) {
      throw new ValidationError(
        `Invalid mode. Supported: ${CONFIG.backup.supportedModes.join(', ')}`
      );
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const sizeValidation = backupService.validateFileSize(fileBuffer.length);
    if (!sizeValidation.valid) {
      throw new ValidationError(sizeValidation.errors[0]);
    }

    const result = await withDeadline(
      (signal) =>
        restoreService.restoreFromBackup(
          user.id,
          fileBuffer,
          mode as 'preview' | 'merge' | 'replace',
          signal
        ),
      OPERATION_TIMEOUTS.RESTORE,
      'Restore from backup'
    );
    return c.json(createSuccessResponse(result, 'Restore operation completed'));
  }
);

export interface RestoreProviderInfo {
  providerId: string;
  providerType: string;
  displayName: string;
  accountEmail: string;
  sourceTypes: ('zip' | 'sheets')[];
}

routes.get('/restore/providers', syncRateLimiter, authorize(ownAccount), async (c) => {
  const user = c.get('user');
  const db = appContext().asyncDb;
  const providers = await db
    .select()
    .from(userProviders)
    .where(
      and(
        eq(userProviders.userId, user.id),
        eq(userProviders.domain, 'storage'),
        ne(userProviders.status, 'disabled')
      )
    );

  const settings = await repos().preferences.getOrCreate(user.id);
  const config: BackupConfig = (settings.backupConfig as BackupConfig | null) ?? {
    providers: {},
  };

  const restoreProviders: RestoreProviderInfo[] = [];

  for (const provider of providers) {
    const providerConfig: ProviderBackupSettings | undefined = config.providers[provider.id];
    if (!providerConfig) continue;

    const sourceTypes: ('zip' | 'sheets')[] = [];

    if (hasZipBackup(providerConfig, provider.providerType) && providerConfig.lastBackupAt) {
      sourceTypes.push('zip');
    }
    if (hasSheetsSync(providerConfig) && providerConfig.sheetsSpreadsheetId) {
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
});

export { routes };
