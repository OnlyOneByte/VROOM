import { z } from 'zod';

export const photoCategoryEnum = z.enum([
  'vehicle_photos',
  'expense_receipts',
  'insurance_docs',
  'odometer_readings',
]);

export const categorySettingSchema = z.object({
  enabled: z.boolean(),
  folderPath: z.string(),
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

export const providerBackupSettingsSchema = z.object({
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

export const backupConfigSchema = z.object({
  providers: z
    .record(z.string().max(64), providerBackupSettingsSchema)
    .refine(providerEntryLimit, providerEntryLimitMessage),
});

export type StorageConfigUpdate = z.infer<typeof storageConfigSchema>;
export type BackupConfigUpdate = z.infer<typeof backupConfigSchema>;
