import { describe, expect, test } from 'bun:test';
import { DEFAULT_STORAGE_CONFIG, type StorageConfig } from '../../../types';
import { backupConfigSchema, storageConfigSchema } from '../validation';

const FULL_ENTRY = {
  vehicle_photos: { enabled: true, folderPath: 'Vehicle' },
  expense_receipts: { enabled: true, folderPath: 'Receipts' },
  insurance_docs: { enabled: true, folderPath: 'Insurance' },
  odometer_readings: { enabled: true, folderPath: 'Odometer' },
};

describe('storageConfigSchema — defaults merge per category, so a subset is valid', () => {
  test('a provider form payload with no category defaults parses', () => {
    const result = storageConfigSchema.safeParse({
      defaults: {},
      providerCategories: { 'drive-1': FULL_ENTRY },
    });

    expect(result.success).toBe(true);
    expect(result.data?.defaults).toEqual({});
  });

  test('a single named default parses without the other three', () => {
    const result = storageConfigSchema.safeParse({
      defaults: { expense_receipts: 'drive-1' },
      providerCategories: { 'drive-1': FULL_ENTRY },
    });

    expect(result.success).toBe(true);
    expect(result.data?.defaults).toEqual({ expense_receipts: 'drive-1' });
  });

  test('an omitted `defaults` parses to an empty object the merge can read unconditionally', () => {
    const result = storageConfigSchema.safeParse({ providerCategories: {} });

    expect(result.success).toBe(true);
    expect(result.data?.defaults).toEqual({});
  });

  test('a category that is sent must carry a provider id or an explicit null', () => {
    expect(storageConfigSchema.safeParse({ defaults: { expense_receipts: 7 } }).success).toBe(
      false
    );
    expect(storageConfigSchema.safeParse({ defaults: { not_a_category: null } }).success).toBe(
      false
    );
    expect(
      storageConfigSchema.safeParse({
        defaults: { expense_receipts: null },
        providerCategories: {},
      }).success
    ).toBe(true);
  });
});

describe('storageConfigSchema — a providerCategories entry is replaced, so it must be complete', () => {
  test('an entry missing a category is rejected rather than half-merged', () => {
    const { expense_receipts, ...missingOne } = FULL_ENTRY;
    expect(expense_receipts).toBeDefined();

    const result = storageConfigSchema.safeParse({
      defaults: {},
      providerCategories: { 'drive-1': missingOne },
    });

    expect(result.success).toBe(false);
  });

  test('more than 20 provider entries is refused', () => {
    const providerCategories = Object.fromEntries(
      Array.from({ length: 21 }, (_, i) => [`drive-${i}`, FULL_ENTRY])
    );

    expect(storageConfigSchema.safeParse({ defaults: {}, providerCategories }).success).toBe(false);
  });
});

describe('a parsed update satisfies what the route does with it', () => {
  test('it merges into a full StorageConfig, and its defaults are always readable', () => {
    const incoming = storageConfigSchema.parse({
      defaults: { expense_receipts: 'drive-1' },
      providerCategories: { 'drive-1': FULL_ENTRY },
    });

    const merged: StorageConfig = {
      defaults: { ...DEFAULT_STORAGE_CONFIG.defaults, ...incoming.defaults },
      providerCategories: {
        ...DEFAULT_STORAGE_CONFIG.providerCategories,
        ...incoming.providerCategories,
      },
    };

    expect(merged.defaults.expense_receipts).toBe('drive-1');
    expect(merged.defaults.vehicle_photos).toBeNull();
    expect(merged.providerCategories['drive-1']?.expense_receipts.folderPath).toBe('Receipts');

    const referencedProviders = Object.values(incoming.defaults).filter(
      (id): id is string => id !== null
    );
    expect(referencedProviders).toEqual(['drive-1']);
  });
});

describe('backupConfigSchema — providers merge per provider, settings are replaced wholesale', () => {
  const settings = { enabled: true, folderPath: 'Backups', retentionCount: 10 };

  test('naming one provider is valid, and an empty map is valid', () => {
    expect(backupConfigSchema.safeParse({ providers: { 'drive-1': settings } }).success).toBe(true);
    expect(backupConfigSchema.safeParse({ providers: {} }).success).toBe(true);
  });

  test("a provider's settings must be complete, and a traversal path is refused", () => {
    expect(
      backupConfigSchema.safeParse({ providers: { 'drive-1': { enabled: true } } }).success
    ).toBe(false);
    expect(
      backupConfigSchema.safeParse({
        providers: { 'drive-1': { ...settings, folderPath: '../../etc' } },
      }).success
    ).toBe(false);
  });
});
