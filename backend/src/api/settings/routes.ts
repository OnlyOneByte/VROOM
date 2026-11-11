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
import { readJsonBody } from '../../utils/request-body';
import {
  mergeUnitPreferences,
  partialUnitPreferencesSchema,
} from '../../utils/unit-preferences-schema';
import { preferencesRepository, syncStateRepository } from './repository';
import {
  type BackupConfigUpdate,
  backupConfigSchema,
  type StorageConfigUpdate,
  storageConfigSchema,
} from './validation';

async function assertProvidersOwned(providerIds: string[], userId: string): Promise<void> {
  if (providerIds.length === 0) return;

  const ownedProviders = await getDb()
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

async function validateStorageConfig(storageConfig: StorageConfig, userId: string): Promise<void> {
  const defaultProviderIds = Object.values(storageConfig.defaults).filter(
    (id): id is string => id !== null
  );
  const categoryProviderIds = Object.keys(storageConfig.providerCategories);
  await assertProvidersOwned([...new Set([...defaultProviderIds, ...categoryProviderIds])], userId);

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

function mergeStorageConfig(
  existing: StorageConfig | null | undefined,
  incoming: StorageConfigUpdate
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

// Providers absent from a partial PUT must survive; a named provider's entry is replaced whole.
function mergeBackupConfig(
  existing: BackupConfig | null | undefined,
  incoming: BackupConfigUpdate
): BackupConfig {
  const existingProviders = existing?.providers ?? {};
  return {
    providers: { ...existingProviders, ...incoming.providers },
  };
}

const routes = new Hono();

routes.use('*', requireAuth);
routes.use('*', changeTracker);

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
    // Bounded because the column is plain text; the cap is an abuse bound, not an allow-list.
    themePreference: z.string().min(1).max(64).optional(),
    // Non-negative and capped; the cap is an abuse bound, not a product limit.
    businessMileageRate: z.number().min(0).max(100).optional(),
  })
  .partial();

routes.get('/', async (c) => {
  const user = c.get('user');

  const prefs = await preferencesRepository.getOrCreate(user.id);

  return c.json({
    success: true,
    data: prefs,
  });
});

routes.put('/', async (c) => {
  const user = c.get('user');
  const body = await readJsonBody(c);
  // ZodError is mapped to a 400 by the central error handler.
  const updates = updateSettingsSchema.parse(body);

  const existingSettings = await preferencesRepository.getOrCreate(user.id);

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

  let mergedStorageConfig: StorageConfig | undefined;
  if (storageConfig) {
    mergedStorageConfig = mergeStorageConfig(existingSettings.storageConfig, storageConfig);
    // Validate the merged result so a category cannot be disabled while it is still a default.
    await validateStorageConfig(mergedStorageConfig, user.id);
  }

  let mergedBackupConfig: BackupConfig | undefined;
  if (backupConfig) {
    await assertProvidersOwned(Object.keys(backupConfig.providers), user.id);
    mergedBackupConfig = mergeBackupConfig(existingSettings.backupConfig, backupConfig);
  }

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

routes.post('/backup', async (c) => {
  const user = c.get('user');
  await syncStateRepository.updateBackupDate(user.id);

  return c.json({
    success: true,
    message: 'Backup completed successfully',
    timestamp: new Date().toISOString(),
  });
});

export { routes };
