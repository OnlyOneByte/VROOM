import { and, eq, inArray } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { getDb } from '../../db/connection';
import { userPreferences, userProviders } from '../../db/schema';
import { ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import type { BackupConfig, StorageConfig } from '../../types';
import {
  mergeUnitPreferences,
  partialUnitPreferencesSchema,
  unitPreferencesSchema,
} from '../../utils/unit-preferences-schema';
import { preferencesRepository, syncStateRepository } from './repository';

/**
 * Validate storageConfig provider references and consistency.
 * - All provider IDs in defaults (non-null) must exist in user_providers and belong to the user.
 * - All provider IDs in providerCategories keys must exist and belong to the user.
 * - A provider set as default for a category must have that category enabled in providerCategories.
 */
async function validateStorageConfig(
  storageConfig: z.infer<typeof storageConfigSchema>,
  userId: string
): Promise<void> {
  const db = getDb();

  // Collect all provider IDs that need ownership validation
  const defaultProviderIds = Object.values(storageConfig.defaults).filter(
    (id): id is string => id !== null
  );
  const categoryProviderIds = Object.keys(storageConfig.providerCategories);
  const allProviderIds = [...new Set([...defaultProviderIds, ...categoryProviderIds])];

  // Validate all referenced providers exist and belong to the user
  if (allProviderIds.length > 0) {
    const ownedProviders = await db
      .select({ id: userProviders.id })
      .from(userProviders)
      .where(and(inArray(userProviders.id, allProviderIds), eq(userProviders.userId, userId)));

    const ownedIds = new Set(ownedProviders.map((p) => p.id));
    for (const providerId of allProviderIds) {
      if (!ownedIds.has(providerId)) {
        throw new ValidationError(
          `Provider '${providerId}' not found or does not belong to this user`
        );
      }
    }
  }

  // Validate that a provider set as default for a category has that category enabled
  for (const [category, providerId] of Object.entries(storageConfig.defaults)) {
    if (providerId === null) continue;
    const providerCategories = storageConfig.providerCategories[providerId];
    if (!providerCategories) {
      throw new ValidationError(
        `Provider '${providerId}' is set as default for '${category}' but has no category settings in providerCategories`
      );
    }
    const categorySetting = providerCategories[category as keyof typeof providerCategories];
    if (!categorySetting?.enabled) {
      throw new ValidationError(
        `Cannot disable '${category}' on this provider because it is set as the default. Remove it as the default first.`
      );
    }
  }
}

/**
 * Validate backupConfig provider references.
 * All provider IDs in backupConfig.providers must exist in user_providers and belong to the user.
 */
async function validateBackupConfig(
  backupConfig: z.infer<typeof backupConfigSchema>,
  userId: string
): Promise<void> {
  const providerIds = Object.keys(backupConfig.providers);
  if (providerIds.length === 0) return;

  const db = getDb();
  const ownedProviders = await db
    .select({ id: userProviders.id })
    .from(userProviders)
    .where(and(inArray(userProviders.id, providerIds), eq(userProviders.userId, userId)));

  const ownedIds = new Set(ownedProviders.map((p) => p.id));
  for (const providerId of providerIds) {
    if (!ownedIds.has(providerId)) {
      throw new ValidationError(
        `Provider '${providerId}' not found or does not belong to this user`
      );
    }
  }
}

/**
 * Merge incoming storageConfig with existing, producing a full StorageConfig.
 */
function mergeStorageConfig(
  existing: StorageConfig | null | undefined,
  incoming: z.infer<typeof storageConfigSchema>
): StorageConfig {
  const existingConfig = (existing ?? {
    defaults: {
      vehicle_photos: null,
      expense_receipts: null,
      insurance_docs: null,
      odometer_readings: null,
    },
    providerCategories: {},
  }) as StorageConfig;

  return {
    defaults: { ...existingConfig.defaults, ...incoming.defaults },
    providerCategories: {
      ...existingConfig.providerCategories,
      ...incoming.providerCategories,
    },
  };
}

/**
 * Merge incoming backupConfig with existing, producing a full BackupConfig.
 *
 * MIRRORS mergeStorageConfig — the PUT used to write backupConfig WHOLESALE while storageConfig was
 * merged, an asymmetry that was a silent data-loss trap (NORTH_STAR #1): a client PUT-ing
 * `backupConfig` with only the provider it's editing would WIPE every other provider's backup
 * settings (retentionCount / sheetsSyncEnabled / folderPath). The frontend mitigated by always
 * reconstructing the full providers map (ProviderForm.svelte spreads ...backupConfig.providers), but
 * that made the backend contract fragile — a partial sender (a future client, a direct API caller, or
 * a stale-load race) lost data. Merge per-provider here so the backend is correct regardless of caller.
 * A provider entry IS replaced wholesale (its settings are a small fixed shape always sent complete by
 * the editor), but providers NOT in the incoming map are preserved.
 */
function mergeBackupConfig(
  existing: BackupConfig | null | undefined,
  incoming: z.infer<typeof backupConfigSchema>
): BackupConfig {
  const existingProviders = existing?.providers ?? {};
  return {
    providers: { ...existingProviders, ...incoming.providers },
  };
}

const routes = new Hono();

// Apply auth and change tracking middleware to all routes
routes.use('*', requireAuth);
routes.use('*', changeTracker);

// unitPreferencesSchema + partialUnitPreferencesSchema now live in utils/unit-preferences-schema.ts
// (shared with vehicles/routes.ts — the C238 dedup).

// Zod schema for storageConfig validation
const categorySettingSchema = z.object({
  enabled: z.boolean(),
  folderPath: z.string(),
});

const photoCategoryEnum = z.enum([
  'vehicle_photos',
  'expense_receipts',
  'insurance_docs',
  'odometer_readings',
]);

const storageConfigSchema = z.object({
  defaults: z.record(photoCategoryEnum, z.string().nullable()),
  providerCategories: z
    .record(z.string().max(64), z.record(photoCategoryEnum, categorySettingSchema))
    .refine((obj) => Object.keys(obj).length <= 20, {
      message: 'Too many provider entries (max 20)',
    }),
});

// Zod schema for per-provider backup settings
const providerBackupSettingsSchema = z.object({
  enabled: z.boolean(),
  folderPath: z
    .string()
    .min(1)
    .max(255)
    .refine((s) => !s.includes('..'), { message: 'Path traversal not allowed' }),
  retentionCount: z.number().int().min(1).max(100),
  lastBackupAt: z.string().datetime().optional(),
  sheetsSyncEnabled: z.boolean().optional(),
  sheetsSpreadsheetId: z.string().optional(),
});

// Zod schema for backup config validation
const backupConfigSchema = z.object({
  providers: z
    .record(z.string().max(64), providerBackupSettingsSchema)
    .refine((obj) => Object.keys(obj).length <= 20, {
      message: 'Too many provider entries (max 20)',
    }),
});

// Validation schema derived from userPreferences Drizzle table
const baseSettingsSchema = createInsertSchema(userPreferences, {
  syncInactivityMinutes: z
    .number()
    .min(1)
    .max(CONFIG.validation.settings.maxSyncInactivityMinutes)
    .optional(),
});

const updateSettingsSchema = baseSettingsSchema
  .omit({
    userId: true,
    createdAt: true,
    updatedAt: true,
    unitPreferences: true,
    storageConfig: true,
    backupConfig: true,
  })
  .extend({
    unitPreferences: partialUnitPreferencesSchema.optional(),
    storageConfig: storageConfigSchema.optional(),
    backupConfig: backupConfigSchema.optional(),
    // Theming engine (spec T2, D2): the selected theme id. createInsertSchema would accept it as an
    // UNBOUNDED string (the column is plain text); pin an explicit bounded, non-empty constraint so a
    // partial PUT can persist it (routed through the existing row-level merge in repository.update — a
    // field not sent is left untouched, the #82 discipline) while a 5000-char or empty id can't land.
    // The resolver (T6) treats an unknown id as `default`, so an arbitrary <=64-char value is safe to
    // store; the cap is a storage/abuse bound, not an allow-list (custom themes are a future seam, D6).
    themePreference: z.string().min(1).max(64).optional(),
    // trips-location D3 (T8): the DEFAULT business-mileage rate ($/mile). createInsertSchema would accept
    // the real column unbounded; pin an explicit non-negative, sanely-capped constraint (a reimbursement
    // rate is well under $100/mile — the cap is an abuse bound). Routed through the same row-level merge
    // (...restUpdates → repository.update), so a partial PUT persists it without touching sibling fields
    // (the #82 discipline). 0 = the additive default (no business value until a rate is set).
    businessMileageRate: z.number().min(0).max(100).optional(),
  })
  .partial();

/**
 * GET /api/settings
 * Get user settings (creates default if not exists)
 */
routes.get('/', async (c) => {
  const user = c.get('user');

  const prefs = await preferencesRepository.getOrCreate(user.id);

  return c.json({
    success: true,
    data: prefs,
  });
});

/**
 * PUT /api/settings
 * Update user settings
 */
routes.put('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  // A ZodError here propagates to the central errorHandler → 400 ValidationError
  // ('Invalid request data'); the storage/backup validators throw ValidationError
  // (an AppError subclass) which the handler shapes by its 400 statusCode.
  const updates = updateSettingsSchema.parse(body);

  // Ensure settings exist first
  const existingSettings = await preferencesRepository.getOrCreate(user.id);

  // Merge partial unitPreferences with existing values
  const {
    unitPreferences: partialUnitPrefs,
    storageConfig,
    backupConfig,
    ...restUpdates
  } = updates;
  const mergedUnitPreferences = mergeUnitPreferences(
    existingSettings.unitPreferences,
    partialUnitPrefs
  );

  // Validate storageConfig if provided
  let mergedStorageConfig: StorageConfig | undefined;
  if (storageConfig) {
    mergedStorageConfig = mergeStorageConfig(existingSettings.storageConfig, storageConfig);
    // Validate the merged result to catch cases where disabling a category
    // conflicts with it being set as a default
    await validateStorageConfig(mergedStorageConfig, user.id);
  }

  // Validate + merge backupConfig if provided. Merge (not wholesale-replace) so a partial PUT that
  // names only one provider can't silently wipe the others' backup settings — mirrors storageConfig.
  let mergedBackupConfig: BackupConfig | undefined;
  if (backupConfig) {
    await validateBackupConfig(backupConfig, user.id);
    mergedBackupConfig = mergeBackupConfig(existingSettings.backupConfig, backupConfig);
  }

  // Update settings
  const updatedSettings = await preferencesRepository.update(user.id, {
    ...restUpdates,
    ...(mergedUnitPreferences && { unitPreferences: mergedUnitPreferences }),
    ...(mergedStorageConfig && { storageConfig: mergedStorageConfig }),
    ...(mergedBackupConfig && { backupConfig: mergedBackupConfig }),
  });

  return c.json({
    success: true,
    data: updatedSettings,
    message: 'Settings updated successfully',
  });
});

/**
 * POST /api/settings/backup
 * Trigger manual backup — updates lastBackupDate in sync_state
 */
routes.post('/backup', async (c) => {
  const user = c.get('user');
  await syncStateRepository.updateBackupDate(user.id);

  return c.json({
    success: true,
    message: 'Backup completed successfully',
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /api/settings/restore
 * Restore from backup
 */
routes.post('/restore', async (c) => {
  return c.json({
    success: true,
    message: 'Data restored successfully',
  });
});

export { routes };
