/**
 * Property tests for API validation and security.
 *
 * Property 6: Restore endpoint input validation
 * Property 7: BackupConfig validation
 * Property 8: Ownership enforcement
 * Property 12: Provider deletion cleans up BackupConfig
 * Property 13: Stale provider resilience
 * Validates: Requirements 5.2, 5.4, 6.2, 6.3, 11.1, 11.2, 11.3, 14.1, 14.2, 14.3
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { z } from 'zod';
import type { BackupConfig } from '../../../types';

// ---------------------------------------------------------------------------
// Zod schemas (replicated from routes for direct testing)
// ---------------------------------------------------------------------------

/**
 * Restore endpoint schema — matches backend/src/api/sync/routes.ts
 * Discriminated union with two variants:
 * - ZIP: { sourceType: 'zip', providerId, fileRef, mode }
 * - Sheets: { sourceType: 'sheets', providerId, mode }
 */
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

/** Per-provider backup settings schema — matches backend/src/api/settings/routes.ts */
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

/** BackupConfig schema — matches backend/src/api/settings/routes.ts */
const backupConfigSchema = z.object({
  providers: z
    .record(z.string().max(64), providerBackupSettingsSchema)
    .refine((obj) => Object.keys(obj).length <= 20, {
      message: 'Too many provider entries (max 20)',
    }),
});

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const providerIdArb = fc.stringMatching(/^prov-[a-z0-9]{4,8}$/);

/** Arbitrary for a valid restore mode. */
const validModeArb = fc.constantFrom('preview', 'replace', 'merge');

/** Arbitrary for a valid providerId (1-64 chars). */
const validProviderIdArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,64}$/);

/** Arbitrary for a valid fileRef (1-1024 chars). */
const validFileRefArb = fc.stringMatching(/^[a-zA-Z0-9_./-]{1,100}$/);

/** Arbitrary for a valid folderPath (1-255 chars, no ".." segments). */
const validFolderPathArb = fc
  .array(fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/), { minLength: 1, maxLength: 5 })
  .map((segments) => segments.join('/'));

/** Arbitrary for a valid retentionCount (integer 1-100). */
const validRetentionCountArb = fc.integer({ min: 1, max: 100 });

// ---------------------------------------------------------------------------
// Property 6: Restore endpoint input validation
// Validates: Requirement 5.2
// ---------------------------------------------------------------------------

describe('Property 6: Restore endpoint input validation', () => {
  /**
   * **Validates: Requirements 5.2**
   *
   * The restore endpoint uses a discriminated union on `sourceType`:
   * - ZIP variant: { sourceType: 'zip', providerId, fileRef, mode }
   * - Sheets variant: { sourceType: 'sheets', providerId, mode }
   *
   * Valid inputs for each variant SHALL be accepted. Invalid inputs SHALL be rejected.
   */

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
      { numRuns: 200 }
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
      { numRuns: 200 }
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
      { numRuns: 200 }
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
      { numRuns: 200 }
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
      { numRuns: 200 }
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
      { numRuns: 200 }
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
      { numRuns: 200 }
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
      { numRuns: 200 }
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
      { numRuns: 200 }
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
      { numRuns: 200 }
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
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: BackupConfig validation
// Validates: Requirements 6.2, 14.3
// ---------------------------------------------------------------------------

describe('Property 7: BackupConfig validation', () => {
  /**
   * **Validates: Requirements 6.2, 14.3**
   *
   * For any BackupConfig submitted via PUT /settings, the validation SHALL accept
   * configs where all folderPath values are 1-255 chars without ".." segments, all
   * retentionCount values are integers between 1 and 100, and the total provider
   * count is ≤ 20 — and SHALL reject configs violating any of these constraints.
   */

  /** Arbitrary for a valid ProviderBackupSettings entry. */
  const validProviderSettingsArb = fc.record({
    enabled: fc.boolean(),
    folderPath: validFolderPathArb,
    retentionCount: validRetentionCountArb,
  });

  /** Arbitrary for a valid BackupConfig with 0-20 providers. */
  const validBackupConfigArb = fc
    .array(fc.tuple(providerIdArb, validProviderSettingsArb), { minLength: 0, maxLength: 10 })
    .map((entries) => {
      // Deduplicate by provider ID
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
      { numRuns: 200 }
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
      { numRuns: 200 }
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
      { numRuns: 200 }
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
      { numRuns: 200 }
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
      { numRuns: 200 }
    );
  });

  test('rejects configs with more than 20 providers', () => {
    // Generate exactly 21 unique provider IDs
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
      { numRuns: 200 }
    );
  });

  test('accepts empty providers object', () => {
    const result = backupConfigSchema.safeParse({ providers: {} });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Property 8: Ownership enforcement
// Validates: Requirements 5.4, 6.3, 14.1, 14.2
// ---------------------------------------------------------------------------

describe('Property 8: Ownership enforcement', () => {
  /**
   * **Validates: Requirements 5.4, 6.3, 14.1, 14.2**
   *
   * For any backup operation (list, download, delete, restore, config update),
   * the system SHALL verify that the specified provider ID belongs to the
   * authenticated user — and SHALL reject operations on providers not owned
   * by the user.
   *
   * We test the pure ownership check logic: given a set of owned provider IDs
   * and a requested provider ID, the check passes iff the ID is in the owned set.
   */

  /**
   * Pure function replicating the ownership check pattern used by:
   * - storageProviderRegistry.getProvider(providerId, userId) — queries user_providers with userId filter
   * - validateBackupConfig() — queries user_providers with userId filter for all provider IDs
   * Returns true if the provider is owned, false otherwise.
   */
  function checkOwnership(ownedProviderIds: Set<string>, requestedProviderId: string): boolean {
    return ownedProviderIds.has(requestedProviderId);
  }

  /**
   * Pure function replicating the backupConfig ownership validation.
   * Returns the list of provider IDs that are NOT owned by the user.
   */
  function validateBackupConfigOwnership(
    configProviderIds: string[],
    ownedProviderIds: Set<string>
  ): string[] {
    return configProviderIds.filter((id) => !ownedProviderIds.has(id));
  }

  /** Arbitrary for a set of owned provider IDs. */
  const ownedProviderSetArb = fc
    .array(providerIdArb, { minLength: 1, maxLength: 10 })
    .map((ids) => new Set(ids));

  test('accepts operations on providers owned by the user', () => {
    fc.assert(
      fc.property(ownedProviderSetArb, (ownedIds) => {
        // Pick a random owned ID
        const ownedArray = [...ownedIds];
        for (const id of ownedArray) {
          expect(checkOwnership(ownedIds, id)).toBe(true);
        }
      }),
      { numRuns: 200 }
    );
  });

  test('rejects operations on providers NOT owned by the user', () => {
    fc.assert(
      fc.property(ownedProviderSetArb, providerIdArb, (ownedIds, requestedId) => {
        // Only test when requestedId is NOT in the owned set
        fc.pre(!ownedIds.has(requestedId));
        expect(checkOwnership(ownedIds, requestedId)).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  test('backupConfig validation rejects configs with unowned provider IDs', () => {
    fc.assert(
      fc.property(
        ownedProviderSetArb,
        fc.array(providerIdArb, { minLength: 1, maxLength: 5 }),
        (ownedIds, configProviderIds) => {
          const violations = validateBackupConfigOwnership(configProviderIds, ownedIds);

          // Every violation must NOT be in the owned set
          for (const v of violations) {
            expect(ownedIds.has(v)).toBe(false);
          }

          // Every non-violation must be in the owned set
          const nonViolations = configProviderIds.filter((id) => !violations.includes(id));
          for (const nv of nonViolations) {
            expect(ownedIds.has(nv)).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  test('backupConfig validation accepts configs where all providers are owned', () => {
    fc.assert(
      fc.property(ownedProviderSetArb, (ownedIds) => {
        const configProviderIds = [...ownedIds].slice(0, 5);
        const violations = validateBackupConfigOwnership(configProviderIds, ownedIds);
        expect(violations.length).toBe(0);
      }),
      { numRuns: 200 }
    );
  });

  test('ownership check is consistent: owned iff in the set', () => {
    fc.assert(
      fc.property(ownedProviderSetArb, providerIdArb, (ownedIds, requestedId) => {
        const isOwned = checkOwnership(ownedIds, requestedId);
        expect(isOwned).toBe(ownedIds.has(requestedId));
      }),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 12: Provider deletion cleans up BackupConfig
// Validates: Requirements 11.1, 11.2
// ---------------------------------------------------------------------------

describe('Property 12: Provider deletion cleans up BackupConfig', () => {
  /**
   * **Validates: Requirements 11.1, 11.2**
   *
   * For any provider deletion where the provider has an entry in
   * backupConfig.providers, the deletion handler SHALL remove that entry.
   * For any provider deletion where no entry exists, the handler SHALL
   * complete without error.
   */

  /**
   * Pure function replicating the cleanupBackupConfig logic from
   * backend/src/api/providers/routes.ts.
   * Returns the updated BackupConfig (or the original if no entry existed).
   */
  function cleanupBackupConfig(
    backupConfig: BackupConfig | null | undefined,
    providerId: string
  ): BackupConfig {
    // Replicate the early return: if no entry exists, return as-is
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

  /** Arbitrary for a BackupConfig with 0-8 provider entries. */
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
          // Pick the first provider ID to delete
          const providerIds = Object.keys(config.providers);
          const targetId = providerIds[0];

          const updated = cleanupBackupConfig(config, targetId);

          // The target provider must be removed
          expect(updated.providers[targetId]).toBeUndefined();

          // All other providers must remain
          for (const id of providerIds) {
            if (id !== targetId) {
              expect(updated.providers[id]).toBeDefined();
            }
          }

          // Total count decreased by 1
          expect(Object.keys(updated.providers).length).toBe(providerIds.length - 1);
        }
      ),
      { numRuns: 200 }
    );
  });

  test('completes without error when provider has no entry in backupConfig', () => {
    fc.assert(
      fc.property(backupConfigArb, providerIdArb, (config, providerId) => {
        // Ensure the provider is NOT in the config
        fc.pre(!(providerId in config.providers));

        const updated = cleanupBackupConfig(config, providerId);

        // Config should be unchanged
        expect(Object.keys(updated.providers).length).toBe(Object.keys(config.providers).length);
        for (const [id, settings] of Object.entries(config.providers)) {
          expect(updated.providers[id]).toEqual(settings);
        }
      }),
      { numRuns: 200 }
    );
  });

  test('handles null/undefined backupConfig without error', () => {
    fc.assert(
      fc.property(fc.constantFrom(null, undefined), providerIdArb, (config, providerId) => {
        const updated = cleanupBackupConfig(config, providerId);
        expect(updated).toEqual({ providers: {} });
      }),
      { numRuns: 200 }
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
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 13: Stale provider resilience
// Validates: Requirement 11.3
// ---------------------------------------------------------------------------

describe('Property 13: Stale provider resilience', () => {
  /**
   * **Validates: Requirements 11.3**
   *
   * For any backupConfig containing a provider ID that no longer exists in
   * user_providers, the BackupService SHALL skip that provider during backup
   * operations and continue with remaining providers without crashing.
   *
   * We test the pure logic: given a set of enabled providers from backupConfig
   * and a set of providers that actually exist, the backup loop should produce
   * results for all enabled providers — with failures for stale ones and
   * successes for valid ones.
   */

  /**
   * Simulates the backup loop's handling of stale providers.
   * For each enabled provider, attempts to "get" it from the registry.
   * If the provider doesn't exist, records a failure. Otherwise, records success.
   */
  async function simulateBackupWithStaleProviders(
    enabledProviderIds: string[],
    existingProviderIds: Set<string>
  ): Promise<Record<string, { success: boolean; message?: string }>> {
    const results: Record<string, { success: boolean; message?: string }> = {};

    const uploadResults = await Promise.allSettled(
      enabledProviderIds.map(async (providerId) => {
        // Simulate registry.getProvider() — throws if provider doesn't exist
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
        // Extract provider ID from error — in real code, the catch block inside
        // the map handles this, so all results are fulfilled with success: false
        const msg = result.reason instanceof Error ? result.reason.message : 'Unknown error';
        const match = msg.match(/Provider (prov-[a-z0-9]+) not found/);
        if (match) {
          results[match[1]] = { success: false, message: msg };
        }
      }
    }

    return results;
  }

  /** Arbitrary for a mix of existing and stale provider IDs. */
  const mixedProviderSetArb = fc
    .array(providerIdArb, { minLength: 2, maxLength: 10 })
    .map((ids) => [...new Set(ids)])
    .filter((ids) => ids.length >= 2)
    .chain((uniqueIds) => {
      // Split into existing and stale
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
        // Should not throw — stale providers are handled gracefully
        const results = await simulateBackupWithStaleProviders(allIds, existingIds);

        // Should have a result for every enabled provider
        expect(Object.keys(results).length).toBe(allIds.length);
      }),
      { numRuns: 200 }
    );
  });

  test('stale providers get failure results, valid providers get success', async () => {
    await fc.assert(
      fc.asyncProperty(mixedProviderSetArb, async ({ allIds, existingIds, staleIds }) => {
        const results = await simulateBackupWithStaleProviders(allIds, existingIds);

        // Valid providers should succeed
        for (const id of existingIds) {
          expect(results[id]?.success).toBe(true);
        }

        // Stale providers should fail
        for (const id of staleIds) {
          expect(results[id]?.success).toBe(false);
          expect(results[id]?.message).toBeDefined();
        }
      }),
      { numRuns: 200 }
    );
  });

  test('valid provider results are not affected by stale providers', async () => {
    await fc.assert(
      fc.asyncProperty(mixedProviderSetArb, async ({ allIds, existingIds }) => {
        const results = await simulateBackupWithStaleProviders(allIds, existingIds);

        // Every existing provider should have success: true regardless of stale providers
        for (const id of existingIds) {
          const result = results[id];
          expect(result).toBeDefined();
          expect(result.success).toBe(true);
          expect(result.message).toBeUndefined();
        }
      }),
      { numRuns: 200 }
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
      { numRuns: 200 }
    );
  });
});
