import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { z } from 'zod';
import type { BackupConfig } from '../../../types';

// Copies of the route validators, kept here for direct testing. Keep them in sync with the routes.
const restoreFromProviderSchema = z.discriminatedUnion('sourceType', [
  z.object({
    sourceType: z.literal('zip'),
    providerId: z.string().min(1).max(64),
    fileRef: z.string().min(1).max(1024),
    mode: z.enum(['preview', 'replace', 'merge']),
  }),
  z.object({
    sourceType: z.literal('sheets'),
    providerId: z.string().min(1).max(64),
    mode: z.enum(['preview', 'replace', 'merge']),
  }),
]);

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

const backupConfigSchema = z.object({
  providers: z
    .record(z.string().max(64), providerBackupSettingsSchema)
    .refine((obj) => Object.keys(obj).length <= 20, {
      message: 'Too many provider entries (max 20)',
    }),
});

const providerIdArb = fc.stringMatching(/^prov-[a-z0-9]{4,8}$/);
const validModeArb = fc.constantFrom('preview', 'replace', 'merge');
const validProviderIdArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,64}$/);
const validFileRefArb = fc.stringMatching(/^[a-zA-Z0-9_./-]{1,100}$/);
const validFolderPathArb = fc
  .array(fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/), { minLength: 1, maxLength: 5 })
  .map((segments) => segments.join('/'));
const validRetentionCountArb = fc.integer({ min: 1, max: 100 });

describe('Restore endpoint input validation', () => {
  test('accepts valid ZIP variant with sourceType, providerId, fileRef, mode', () => {
    fc.assert(
      fc.property(
        validProviderIdArb,
        validFileRefArb,
        validModeArb,
        (providerId, fileRef, mode) => {
          const result = restoreFromProviderSchema.safeParse({
            sourceType: 'zip',
            providerId,
            fileRef,
            mode,
          });
          expect(result.success).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('accepts valid Sheets variant with sourceType, providerId, mode (no fileRef)', () => {
    fc.assert(
      fc.property(validProviderIdArb, validModeArb, (providerId, mode) => {
        const result = restoreFromProviderSchema.safeParse({
          sourceType: 'sheets',
          providerId,
          mode,
        });
        expect(result.success).toBe(true);
      }),
      { numRuns: 50 }
    );
  });

  test('rejects ZIP variant with empty providerId', () => {
    fc.assert(
      fc.property(validFileRefArb, validModeArb, (fileRef, mode) => {
        const result = restoreFromProviderSchema.safeParse({
          sourceType: 'zip',
          providerId: '',
          fileRef,
          mode,
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  test('rejects Sheets variant with empty providerId', () => {
    fc.assert(
      fc.property(validModeArb, (mode) => {
        const result = restoreFromProviderSchema.safeParse({
          sourceType: 'sheets',
          providerId: '',
          mode,
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  test('rejects ZIP variant with providerId longer than 64 chars', () => {
    const longProviderIdArb = fc.stringMatching(/^[a-z]{65,80}$/);
    fc.assert(
      fc.property(longProviderIdArb, validFileRefArb, validModeArb, (providerId, fileRef, mode) => {
        const result = restoreFromProviderSchema.safeParse({
          sourceType: 'zip',
          providerId,
          fileRef,
          mode,
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  test('rejects ZIP variant with empty fileRef', () => {
    fc.assert(
      fc.property(validProviderIdArb, validModeArb, (providerId, mode) => {
        const result = restoreFromProviderSchema.safeParse({
          sourceType: 'zip',
          providerId,
          fileRef: '',
          mode,
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  test('rejects ZIP variant with missing fileRef', () => {
    fc.assert(
      fc.property(validProviderIdArb, validModeArb, (providerId, mode) => {
        const result = restoreFromProviderSchema.safeParse({
          sourceType: 'zip',
          providerId,
          mode,
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  test('rejects invalid mode values for both variants', () => {
    const invalidModeArb = fc
      .stringMatching(/^[a-z]{3,10}$/)
      .filter((s) => !['preview', 'replace', 'merge'].includes(s));
    fc.assert(
      fc.property(
        validProviderIdArb,
        validFileRefArb,
        invalidModeArb,
        (providerId, fileRef, mode) => {
          const zipResult = restoreFromProviderSchema.safeParse({
            sourceType: 'zip',
            providerId,
            fileRef,
            mode,
          });
          expect(zipResult.success).toBe(false);

          const sheetsResult = restoreFromProviderSchema.safeParse({
            sourceType: 'sheets',
            providerId,
            mode,
          });
          expect(sheetsResult.success).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('rejects missing sourceType', () => {
    fc.assert(
      fc.property(
        validProviderIdArb,
        validFileRefArb,
        validModeArb,
        (providerId, fileRef, mode) => {
          const result = restoreFromProviderSchema.safeParse({ providerId, fileRef, mode });
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('rejects invalid sourceType', () => {
    const invalidSourceTypeArb = fc
      .stringMatching(/^[a-z]{3,10}$/)
      .filter((s) => !['zip', 'sheets'].includes(s));
    fc.assert(
      fc.property(
        invalidSourceTypeArb,
        validProviderIdArb,
        validModeArb,
        (sourceType, providerId, mode) => {
          const result = restoreFromProviderSchema.safeParse({ sourceType, providerId, mode });
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('rejects non-string providerId and fileRef', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.constant(undefined)),
        (badValue) => {
          const result1 = restoreFromProviderSchema.safeParse({
            sourceType: 'zip',
            providerId: badValue,
            fileRef: 'valid',
            mode: 'preview',
          });
          expect(result1.success).toBe(false);

          const result2 = restoreFromProviderSchema.safeParse({
            sourceType: 'zip',
            providerId: 'valid',
            fileRef: badValue,
            mode: 'preview',
          });
          expect(result2.success).toBe(false);

          const result3 = restoreFromProviderSchema.safeParse({
            sourceType: 'sheets',
            providerId: badValue,
            mode: 'preview',
          });
          expect(result3.success).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('BackupConfig validation', () => {
  const validProviderSettingsArb = fc.record({
    enabled: fc.boolean(),
    folderPath: validFolderPathArb,
    retentionCount: validRetentionCountArb,
  });

  const validBackupConfigArb = fc
    .array(fc.tuple(providerIdArb, validProviderSettingsArb), { minLength: 0, maxLength: 10 })
    .map((entries) => {
      const seen = new Set<string>();
      const unique = entries.filter(([id]) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      return {
        providers: Object.fromEntries(unique),
      };
    });

  test('accepts valid configs with valid folderPath, retentionCount, and ≤20 providers', () => {
    fc.assert(
      fc.property(validBackupConfigArb, (config) => {
        const result = backupConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
      }),
      { numRuns: 50 }
    );
  });

  test('rejects folderPath containing ".." (path traversal)', () => {
    const pathTraversalArb = fc.constantFrom(
      'Backups/../etc',
      '../secrets',
      'foo/..bar/../baz',
      '..',
      'a/../b'
    );
    fc.assert(
      fc.property(providerIdArb, pathTraversalArb, (providerId, folderPath) => {
        const config = {
          providers: {
            [providerId]: { enabled: true, folderPath, retentionCount: 10 },
          },
        };
        const result = backupConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  test('rejects empty folderPath', () => {
    fc.assert(
      fc.property(providerIdArb, (providerId) => {
        const config = {
          providers: {
            [providerId]: { enabled: true, folderPath: '', retentionCount: 10 },
          },
        };
        const result = backupConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  test('rejects retentionCount outside 1-100 range', () => {
    const invalidRetentionArb = fc.oneof(
      fc.integer({ min: -100, max: 0 }),
      fc.integer({ min: 101, max: 1000 })
    );
    fc.assert(
      fc.property(
        providerIdArb,
        validFolderPathArb,
        invalidRetentionArb,
        (providerId, folderPath, retentionCount) => {
          const config = {
            providers: {
              [providerId]: { enabled: true, folderPath, retentionCount },
            },
          };
          const result = backupConfigSchema.safeParse(config);
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('rejects non-integer retentionCount', () => {
    const nonIntArb = fc
      .double({ min: 1.01, max: 99.99, noNaN: true })
      .filter((n) => !Number.isInteger(n));
    fc.assert(
      fc.property(
        providerIdArb,
        validFolderPathArb,
        nonIntArb,
        (providerId, folderPath, retentionCount) => {
          const config = {
            providers: {
              [providerId]: { enabled: true, folderPath, retentionCount },
            },
          };
          const result = backupConfigSchema.safeParse(config);
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('rejects configs with more than 20 providers', () => {
    const tooManyProvidersArb = fc
      .array(providerIdArb, { minLength: 30, maxLength: 40 })
      .map((ids) => [...new Set(ids)])
      .filter((ids) => ids.length >= 21)
      .map((ids) => ids.slice(0, 21));

    fc.assert(
      fc.property(tooManyProvidersArb, (providerIds) => {
        const config = {
          providers: Object.fromEntries(
            providerIds.map((id) => [
              id,
              { enabled: true, folderPath: 'Backups', retentionCount: 10 },
            ])
          ),
        };
        expect(Object.keys(config.providers).length).toBeGreaterThan(20);
        const result = backupConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  test('accepts empty providers object', () => {
    const result = backupConfigSchema.safeParse({ providers: {} });
    expect(result.success).toBe(true);
  });
});

describe('Provider deletion cleans up BackupConfig', () => {
  // Copy of cleanupBackupConfig in providers/routes.ts.
  function cleanupBackupConfig(
    backupConfig: BackupConfig | null | undefined,
    providerId: string
  ): BackupConfig {
    if (!backupConfig?.providers?.[providerId]) {
      return backupConfig ?? { providers: {} };
    }
    const updated: BackupConfig = {
      ...backupConfig,
      providers: { ...backupConfig.providers },
    };
    delete updated.providers[providerId];
    return updated;
  }

  const backupConfigArb: fc.Arbitrary<BackupConfig> = fc
    .array(
      fc.tuple(
        providerIdArb,
        fc.record({
          enabled: fc.boolean(),
          folderPath: fc.constant('Backups'),
          retentionCount: fc.integer({ min: 1, max: 100 }),
        })
      ),
      { minLength: 0, maxLength: 8 }
    )
    .map((entries) => {
      const seen = new Set<string>();
      const unique = entries.filter(([id]) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      return { providers: Object.fromEntries(unique) } as BackupConfig;
    });

  test('removes the provider entry when it exists in backupConfig', () => {
    fc.assert(
      fc.property(
        backupConfigArb.filter((c) => Object.keys(c.providers).length > 0),
        (config) => {
          const providerIds = Object.keys(config.providers);
          const targetId = providerIds[0];

          const updated = cleanupBackupConfig(config, targetId);

          expect(updated.providers[targetId]).toBeUndefined();

          for (const id of providerIds) {
            if (id !== targetId) {
              expect(updated.providers[id]).toBeDefined();
            }
          }

          expect(Object.keys(updated.providers).length).toBe(providerIds.length - 1);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('completes without error when provider has no entry in backupConfig', () => {
    fc.assert(
      fc.property(backupConfigArb, providerIdArb, (config, providerId) => {
        fc.pre(!(providerId in config.providers));

        const updated = cleanupBackupConfig(config, providerId);

        expect(Object.keys(updated.providers).length).toBe(Object.keys(config.providers).length);
        for (const [id, settings] of Object.entries(config.providers)) {
          expect(updated.providers[id]).toEqual(settings);
        }
      }),
      { numRuns: 50 }
    );
  });

  test('handles null/undefined backupConfig without error', () => {
    fc.assert(
      fc.property(fc.constantFrom(null, undefined), providerIdArb, (config, providerId) => {
        const updated = cleanupBackupConfig(config, providerId);
        expect(updated).toEqual({ providers: {} });
      }),
      { numRuns: 50 }
    );
  });

  test('cleanup is idempotent — deleting same provider twice yields same result', () => {
    fc.assert(
      fc.property(
        backupConfigArb.filter((c) => Object.keys(c.providers).length > 0),
        (config) => {
          const targetId = Object.keys(config.providers)[0];

          const afterFirst = cleanupBackupConfig(config, targetId);
          const afterSecond = cleanupBackupConfig(afterFirst, targetId);

          expect(afterSecond).toEqual(afterFirst);
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('Stale provider resilience', () => {
  async function simulateBackupWithStaleProviders(
    enabledProviderIds: string[],
    existingProviderIds: Set<string>
  ): Promise<Record<string, { success: boolean; message?: string }>> {
    const results: Record<string, { success: boolean; message?: string }> = {};

    const uploadResults = await Promise.allSettled(
      enabledProviderIds.map(async (providerId) => {
        if (!existingProviderIds.has(providerId)) {
          throw new Error(`Provider ${providerId} not found`);
        }
        return { providerId, success: true as const };
      })
    );

    for (const result of uploadResults) {
      if (result.status === 'fulfilled') {
        results[result.value.providerId] = { success: true };
      } else {
        const msg = result.reason instanceof Error ? result.reason.message : 'Unknown error';
        const match = msg.match(/Provider (prov-[a-z0-9]+) not found/);
        if (match) {
          results[match[1]] = { success: false, message: msg };
        }
      }
    }

    return results;
  }

  const mixedProviderSetArb = fc
    .array(providerIdArb, { minLength: 2, maxLength: 10 })
    .map((ids) => [...new Set(ids)])
    .filter((ids) => ids.length >= 2)
    .chain((uniqueIds) => {
      const splitPoint = Math.max(1, Math.floor(uniqueIds.length / 2));
      return fc.constant({
        allIds: uniqueIds,
        existingIds: new Set(uniqueIds.slice(0, splitPoint)),
        staleIds: uniqueIds.slice(splitPoint),
      });
    });

  test('does not crash when backupConfig contains stale provider IDs', async () => {
    await fc.assert(
      fc.asyncProperty(mixedProviderSetArb, async ({ allIds, existingIds }) => {
        const results = await simulateBackupWithStaleProviders(allIds, existingIds);

        expect(Object.keys(results).length).toBe(allIds.length);
      }),
      { numRuns: 50 }
    );
  });

  test('stale providers get failure results, valid providers get success', async () => {
    await fc.assert(
      fc.asyncProperty(mixedProviderSetArb, async ({ allIds, existingIds, staleIds }) => {
        const results = await simulateBackupWithStaleProviders(allIds, existingIds);

        for (const id of existingIds) {
          expect(results[id]?.success).toBe(true);
        }

        for (const id of staleIds) {
          expect(results[id]?.success).toBe(false);
          expect(results[id]?.message).toBeDefined();
        }
      }),
      { numRuns: 50 }
    );
  });

  test('valid provider results are not affected by stale providers', async () => {
    await fc.assert(
      fc.asyncProperty(mixedProviderSetArb, async ({ allIds, existingIds }) => {
        const results = await simulateBackupWithStaleProviders(allIds, existingIds);

        for (const id of existingIds) {
          const result = results[id];
          expect(result).toBeDefined();
          expect(result.success).toBe(true);
          expect(result.message).toBeUndefined();
        }
      }),
      { numRuns: 50 }
    );
  });

  test('all-stale config produces all-failure results without crashing', async () => {
    fc.assert(
      fc.asyncProperty(
        fc.array(providerIdArb, { minLength: 1, maxLength: 5 }).map((ids) => [...new Set(ids)]),
        async (staleIds) => {
          const emptyExisting = new Set<string>();
          const results = await simulateBackupWithStaleProviders(staleIds, emptyExisting);

          expect(Object.keys(results).length).toBe(staleIds.length);
          for (const id of staleIds) {
            expect(results[id]?.success).toBe(false);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
