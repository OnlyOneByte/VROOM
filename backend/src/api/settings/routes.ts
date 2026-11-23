import { and, eq, inArray } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { getDb } from '../../db/connection';
import { userPreferences, userProviders } from '../../db/schema';
import { ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import SHARED_CURRENCIES from '../../shared-currencies.json';
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

const SERVER_OWNED_BACKUP_FIELDS = new Set([
  'lastBackupAt',
  'sheetsSpreadsheetId',
  'sheetsAutoPausedAt',
]);

function clientBackupConfigPatch(
  existing: BackupConfig | null | undefined,
  incoming: BackupConfigUpdate
): Record<string, unknown> {
  const providers: Record<string, Record<string, unknown>> = {};
  for (const [providerId, settings] of Object.entries(incoming.providers)) {
    const entry: Record<string, unknown> = {};
    for (const key of Object.keys(existing?.providers?.[providerId] ?? {})) {
      if (!SERVER_OWNED_BACKUP_FIELDS.has(key)) entry[key] = null;
    }
    for (const [key, value] of Object.entries(settings)) {
      if (!SERVER_OWNED_BACKUP_FIELDS.has(key)) entry[key] = value;
    }
    providers[providerId] = entry;
  }
  return { providers };
}

const routes = new Hono();

routes.use('*', requireAuth);
routes.use('*', changeTracker);

const SUPPORTED_CURRENCIES = new Set(SHARED_CURRENCIES.currencies);

const baseSettingsSchema = createInsertSchema(userPreferences, {
  currencyUnit: z
    .string()
    .refine((code) => SUPPORTED_CURRENCIES.has(code), 'Unknown currency code')
    .optional(),
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
    themePreference: z.string().min(1).max(64).optional(),
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
    await validateStorageConfig(mergedStorageConfig, user.id);
  }

  if (backupConfig) {
    await assertProvidersOwned(Object.keys(backupConfig.providers), user.id);
  }

  let updatedSettings = await preferencesRepository.update(user.id, {
    ...restUpdates,
    ...(mergedUnitPreferences && { unitPreferences: mergedUnitPreferences }),
    ...(mergedStorageConfig && { storageConfig: mergedStorageConfig }),
  });
  if (backupConfig) {
    updatedSettings =
      (await preferencesRepository.mergeJsonField(
        user.id,
        'backupConfig',
        clientBackupConfigPatch(existingSettings.backupConfig, backupConfig)
      )) ?? updatedSettings;
  }

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
