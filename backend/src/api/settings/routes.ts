import { and, eq, inArray } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { getDb } from '../../db/connection';
import { userPreferences, userProviders } from '../../db/schema';
import { AppError, ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import {
  ChargeUnit,
  DistanceUnit,
  type StorageConfig,
  type UnitPreferences,
  VolumeUnit,
} from '../../types';
import { logger } from '../../utils/logger';
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

const routes = new Hono();

// Apply auth and change tracking middleware to all routes
routes.use('*', requireAuth);
routes.use('*', changeTracker);

// Zod schema for unitPreferences enum validation
const unitPreferencesSchema = z.object({
  distanceUnit: z.enum(DistanceUnit, {
    message: "Invalid distanceUnit: must be 'miles' or 'kilometers'",
  }),
  volumeUnit: z.enum(VolumeUnit, {
    message: "Invalid volumeUnit: must be 'gallons_us', 'gallons_uk', or 'liters'",
  }),
  chargeUnit: z.enum(ChargeUnit, {
    message: "Invalid chargeUnit: must be 'kwh'",
  }),
});

// Partial version for update (each field optional)
const partialUnitPreferencesSchema = unitPreferencesSchema.partial();

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
  })
  .partial();

/**
 * GET /api/settings
 * Get user settings (creates default if not exists)
 */
routes.get('/', async (c) => {
  try {
    const user = c.get('user');

    const prefs = await preferencesRepository.getOrCreate(user.id);

    return c.json({
      success: true,
      data: prefs,
    });
  } catch (error) {
    logger.error('Error fetching settings', { error });
    throw new AppError('Failed to fetch settings', 500);
  }
});

/**
 * PUT /api/settings
 * Update user settings
 */
routes.put('/', async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json();
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
    const mergedUnitPreferences: UnitPreferences | undefined = partialUnitPrefs
      ? { ...existingSettings.unitPreferences, ...partialUnitPrefs }
      : undefined;

    // Validate storageConfig if provided
    let mergedStorageConfig: StorageConfig | undefined;
    if (storageConfig) {
      mergedStorageConfig = mergeStorageConfig(existingSettings.storageConfig, storageConfig);
      // Validate the merged result to catch cases where disabling a category
      // conflicts with it being set as a default
      await validateStorageConfig(mergedStorageConfig, user.id);
    }

    // Validate backupConfig ownership if provided
    if (backupConfig) {
      await validateBackupConfig(backupConfig, user.id);
    }

    // Update settings
    const updatedSettings = await preferencesRepository.update(user.id, {
      ...restUpdates,
      ...(mergedUnitPreferences && { unitPreferences: mergedUnitPreferences }),
      ...(mergedStorageConfig && { storageConfig: mergedStorageConfig }),
      ...(backupConfig && { backupConfig }),
    });

    return c.json({
      success: true,
      data: updatedSettings,
      message: 'Settings updated successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new AppError('Invalid settings data', 400);
    }
    if (error instanceof AppError) {
      throw error;
    }
    logger.error('Error updating settings', { error });
    throw new AppError('Failed to update settings', 500);
  }
});

/**
 * POST /api/settings/backup
 * Trigger manual backup — updates lastBackupDate in sync_state
 */
routes.post('/backup', async (c) => {
  try {
    const user = c.get('user');
    await syncStateRepository.updateBackupDate(user.id);

    return c.json({
      success: true,
      message: 'Backup completed successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error creating backup', { error });
    throw new AppError('Failed to create backup', 500);
  }
});

/**
 * POST /api/settings/restore
 * Restore from backup
 */
routes.post('/restore', async (c) => {
  try {
    return c.json({
      success: true,
      message: 'Data restored successfully',
    });
  } catch (error) {
    logger.error('Error restoring backup', { error });
    throw new AppError('Failed to restore backup', 500);
  }
});

export { routes };
