/**
 * Request schemas for the two JSON columns PUT /settings accepts as PARTIAL updates.
 *
 * Both columns are merged server-side (mergeStorageConfig / mergeBackupConfig), so a caller is
 * expected to send only the part it edits — the provider form sends one provider's folder paths and
 * nothing else. The schemas therefore have to ACCEPT that shape, and the granularity at which each
 * field is merged is exactly the granularity at which it may be omitted:
 *
 *  - `storageConfig.defaults` merges per CATEGORY, so any subset of the four categories is valid and
 *    an absent category means "leave this default alone". In Zod 4 `z.record(enum, v)` is EXHAUSTIVE
 *    — it demands every enum key — which rejected every partial submit with a 400; `partialRecord` is
 *    the key-optional form, and the `.default({})` keeps the parsed value an object so the merge and
 *    the ownership validation can read it unconditionally.
 *  - a `providerCategories` ENTRY is replaced wholesale (its four categories are one small fixed
 *    shape the editor always sends complete), so the inner record stays exhaustive on purpose: a
 *    partial entry would silently drop the categories it omits instead of merging them.
 *  - `backupConfig.providers` merges per PROVIDER, and a provider's settings are likewise replaced
 *    wholesale, so that object stays fully required.
 *
 * Provider ownership + default/enabled consistency are NOT checked here — they need the DB and live
 * in the route's validateStorageConfig / validateBackupConfig.
 */

import { z } from 'zod';

/** The four photo categories, as stored in the storage_config JSON column. */
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

/** Max provider entries per map — a storage/abuse bound, not a product limit. */
const MAX_PROVIDER_ENTRIES = 20;

const providerEntryLimit = (obj: object) => Object.keys(obj).length <= MAX_PROVIDER_ENTRIES;
const providerEntryLimitMessage = {
  message: `Too many provider entries (max ${MAX_PROVIDER_ENTRIES})`,
};

export const storageConfigSchema = z.object({
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

/** A storageConfig update as the route sees it after parsing: `defaults` is always an object. */
export type StorageConfigUpdate = z.infer<typeof storageConfigSchema>;
export type BackupConfigUpdate = z.infer<typeof backupConfigSchema>;
