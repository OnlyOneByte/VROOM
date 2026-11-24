import { z } from 'zod';
import SHARED_REGIONS from '../../shared-regions.json';
import { storagePathSchema } from '../../utils/paths';

const photoCategoryEnum = z.enum([
  'vehicle_photos',
  'expense_receipts',
  'insurance_docs',
  'odometer_readings',
]);

const categorySettingSchema = z.object({
  enabled: z.boolean(),
  folderPath: storagePathSchema,
});

const MAX_PROVIDER_ENTRIES = 20;

const providerEntryLimit = (obj: object) => Object.keys(obj).length <= MAX_PROVIDER_ENTRIES;
const providerEntryLimitMessage = {
  message: `Too many provider entries (max ${MAX_PROVIDER_ENTRIES})`,
};

export const storageConfigSchema = z.object({
  // Zod 4: z.record over an enum is exhaustive, so partialRecord is needed to allow omitted keys.
  defaults: z.partialRecord(photoCategoryEnum, z.string().nullable()).default({}),
  providerCategories: z
    .record(z.string().max(64), z.record(photoCategoryEnum, categorySettingSchema))
    .refine(providerEntryLimit, providerEntryLimitMessage),
});

const providerBackupSettingsSchema = z.object({
  enabled: z.boolean(),
  folderPath: storagePathSchema.min(1),
  retentionCount: z.number().int().min(1).max(100),
  lastBackupAt: z.string().datetime().optional(),
  sheetsSyncEnabled: z.boolean().optional(),
  sheetsSpreadsheetId: z.string().optional(),
});

export const backupConfigSchema = z.object({
  providers: z
    .record(z.string().max(64), providerBackupSettingsSchema)
    .refine(providerEntryLimit, providerEntryLimitMessage),
});

export const providerDefaultsSchema = z
  .object({
    'ai.llm': z.string().max(64).nullable(),
    'ai.vision': z.string().max(64).nullable(),
  })
  .partial()
  .strict();

const KNOWN_REGIONS = new Set([
  ...SHARED_REGIONS.countries,
  ...Object.keys(SHARED_REGIONS.subdivisions),
]);

export function isKnownRegion(code: string): boolean {
  return KNOWN_REGIONS.has(code);
}

export const communityRegionSchema = z.string().refine(isKnownRegion, 'Unknown region code');

export type StorageConfigUpdate = z.infer<typeof storageConfigSchema>;
export type BackupConfigUpdate = z.infer<typeof backupConfigSchema>;
