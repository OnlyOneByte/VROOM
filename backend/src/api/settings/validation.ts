/**
 * Request schemas for the JSON columns that PUT /settings merges as partial updates. The granularity
 * of each merge sets what may be omitted: `defaults` merges per category, while provider entries
 * are replaced whole, so their inner objects stay exhaustive. Ownership checks live in routes.ts.
 */

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

// An abuse bound, not a product limit.
const MAX_PROVIDER_ENTRIES = 20;

const providerEntryLimit = (obj: object) => Object.keys(obj).length <= MAX_PROVIDER_ENTRIES;
const providerEntryLimitMessage = {
  message: `Too many provider entries (max ${MAX_PROVIDER_ENTRIES})`,
};

export const storageConfigSchema = z.object({
  // z.record over an enum is exhaustive in Zod 4; partialRecord lets callers omit categories.
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
