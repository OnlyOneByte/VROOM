import { and, eq, inArray } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { z } from 'zod';
import { appContext, repos } from '../../app-context';
import { CONFIG } from '../../config';
import {
  type NewUserPreferences,
  type UserPreferences,
  userPreferences,
  userProviders,
} from '../../db/schema';
import { ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { authorize, ownAccount } from '../../permissions/authorize';
import SHARED_CURRENCIES from '../../shared-currencies.json';
import {
  type BackupConfig,
  DEFAULT_UNIT_PREFERENCES,
  type DefaultProviderCapability,
  parseUnitPreferences,
  type StorageConfig,
  type UnitPreferences,
} from '../../types';
import { readJsonBody } from '../../utils/request-body';
import { convertDistance } from '../../utils/unit-conversions';
import {
  mergeUnitPreferences,
  partialUnitPreferencesSchema,
} from '../../utils/unit-preferences-schema';
import { LOCAL_OCR_PROVIDER_ID, localOcrEnabled } from '../providers/domains/vlm/registry';
import { CAPABILITY_DOMAIN } from '../providers/resolve';
import { updatePreferencesWithCurrency } from './repository';
import {
  type BackupConfigUpdate,
  backupConfigSchema,
  communityRegionSchema,
  providerDefaultsSchema,
  type StorageConfigUpdate,
  storageConfigSchema,
} from './validation';

async function assertProvidersOwned(providerIds: string[], userId: string): Promise<void> {
  if (providerIds.length === 0) return;

  const ownedProviders = await appContext()
    .asyncDb.select({ id: userProviders.id })
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

async function assertDefaultsOwned(
  defaults: Partial<Record<DefaultProviderCapability, string | null>>,
  userId: string
): Promise<void> {
  for (const [capability, providerId] of Object.entries(defaults)) {
    if (providerId === null || providerId === undefined) continue;
    if (capability === 'ai.vision' && providerId === LOCAL_OCR_PROVIDER_ID) {
      if (localOcrEnabled()) continue;
      throw new ValidationError('The built-in text reader is turned off on this server');
    }
    const owned = await appContext()
      .asyncDb.select({ id: userProviders.id })
      .from(userProviders)
      .where(
        and(
          eq(userProviders.id, providerId),
          eq(userProviders.userId, userId),
          eq(userProviders.domain, CAPABILITY_DOMAIN[capability as DefaultProviderCapability])
        )
      )
      .get();
    if (!owned) {
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
): Record<string, Record<string, unknown>> {
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
  return providers;
}

function consentUpdate(
  existing: Pick<UserPreferences, 'communityStatsOptIn'>,
  optIn: boolean | undefined
): Pick<NewUserPreferences, 'communityStatsOptIn' | 'communityStatsConsentedAt'> {
  if (optIn === undefined || optIn === existing.communityStatsOptIn) return {};
  return { communityStatsOptIn: optIn, communityStatsConsentedAt: optIn ? new Date() : null };
}

function withServerSettings<T extends object>(prefs: T) {
  return {
    ...prefs,
    communityStatsMode: CONFIG.communityStats.mode,
    communityStatsMinGroup: CONFIG.communityStats.minGroup,
  };
}

const routes = new Hono();

routes.use('*', requireAuth);
routes.use('*', changeTracker);

const SUPPORTED_CURRENCIES = new Set(SHARED_CURRENCIES.currencies);
const MAX_BUSINESS_MILEAGE_RATE = 1_000_000;

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
    providerDefaults: true,
    communityStatsConsentedAt: true,
  })
  .extend({
    unitPreferences: partialUnitPreferencesSchema.optional(),
    storageConfig: storageConfigSchema.optional(),
    backupConfig: backupConfigSchema.optional(),
    providerDefaults: providerDefaultsSchema.optional(),
    themePreference: z.string().min(1).max(64).optional(),
    businessMileageRate: z.number().min(0).max(MAX_BUSINESS_MILEAGE_RATE).optional(),
    communityStatsOptIn: z.boolean().optional(),
    communityRegion: communityRegionSchema.nullable().optional(),
  })
  .partial();

routes.get('/', authorize(ownAccount), async (c) => {
  const user = c.get('user');

  const prefs = await repos().preferences.getOrCreate(user.id);

  return c.json({
    success: true,
    data: withServerSettings(prefs),
  });
});

function rateInNewDistanceUnit(
  existing: { unitPreferences: unknown; businessMileageRate: number },
  merged: UnitPreferences | undefined,
  requestedRate: number | undefined
): { businessMileageRate?: number } {
  const to = merged?.distanceUnit;
  if (requestedRate !== undefined || !to || existing.businessMileageRate <= 0) return {};
  const from = (parseUnitPreferences(existing.unitPreferences) ?? DEFAULT_UNIT_PREFERENCES)
    .distanceUnit;
  if (to === from) return {};
  const perNewUnit = existing.businessMileageRate * convertDistance(1, to, from);
  const rounded =
    perNewUnit < 0.0001
      ? Number(perNewUnit.toPrecision(4))
      : Math.round(perNewUnit * 10_000) / 10_000;
  return { businessMileageRate: Math.min(rounded, MAX_BUSINESS_MILEAGE_RATE) };
}

routes.put('/', authorize(ownAccount), async (c) => {
  const user = c.get('user');
  const body = await readJsonBody(c);
  const updates = updateSettingsSchema.parse(body);

  const existingSettings = await repos().preferences.getOrCreate(user.id);

  const {
    unitPreferences: partialUnitPrefs,
    storageConfig,
    backupConfig,
    providerDefaults,
    communityStatsOptIn,
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
  if (providerDefaults) {
    await assertDefaultsOwned(providerDefaults, user.id);
  }

  const preferenceUpdates = {
    ...restUpdates,
    ...rateInNewDistanceUnit(
      existingSettings,
      mergedUnitPreferences,
      restUpdates.businessMileageRate
    ),
    ...(mergedUnitPreferences && { unitPreferences: mergedUnitPreferences }),
    ...(mergedStorageConfig && { storageConfig: mergedStorageConfig }),
    ...consentUpdate(existingSettings, communityStatsOptIn),
  };
  const { currencyUnit } = preferenceUpdates;
  let updatedSettings = currencyUnit
    ? await updatePreferencesWithCurrency(appContext().asyncDb, user.id, {
        ...preferenceUpdates,
        currencyUnit,
      })
    : await repos().preferences.update(user.id, preferenceUpdates);
  if (providerDefaults) {
    updatedSettings =
      (await repos().preferences.mergeJsonField(user.id, 'providerDefaults', providerDefaults)) ??
      updatedSettings;
  }
  if (backupConfig) {
    updatedSettings =
      (await repos().preferences.mergeLiveBackupProviders(
        user.id,
        clientBackupConfigPatch(existingSettings.backupConfig, backupConfig)
      )) ?? (await repos().preferences.getOrCreate(user.id));
  }

  return c.json({
    success: true,
    data: withServerSettings(updatedSettings),
    message: 'Settings updated successfully',
  });
});

export { routes };
