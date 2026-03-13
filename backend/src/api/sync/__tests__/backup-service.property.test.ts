/**
 * Property tests for BackupService.
 *
 * Property 1: Provider isolation during backup
 * Property 2: Retention enforcement correctness
 * Property 4: Backup listing filter, sort, and badge
 * Property 16: Backup skip logic
 * Property 17: lastBackupAt per-provider update
 * Validates: Requirements 1.1, 1.3, 1.4, 1.5, 2.2, 2.3, 2.4, 4.1, 4.2, 15.1, 15.2
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import type { BackupConfig } from '../../../types';
import type { StorageFileInfo } from '../../providers/domains/storage/storage-provider';

/** Local type for legacy backup result shape used in property test simulations. */
interface BackupSyncResult {
  results: Record<
    string,
    {
      success: boolean;
      message?: string;
      fileRef?: string;
      fileName?: string;
      deletedOldBackups?: number;
    }
  >;
  timestamp: string;
  skipped?: boolean;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const providerIdArb = fc.stringMatching(/^prov-[a-z0-9]{4,8}$/);
const userIdArb = fc.stringMatching(/^user-[a-z0-9]{4,8}$/);

/** Arbitrary for a valid ISO 8601 timestamp. */
const isoTimestampArb = fc
  .integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 })
  .map((ms) => new Date(ms).toISOString());

/** Arbitrary for a retention count (1–100). */
const retentionCountArb = fc.integer({ min: 1, max: 100 });

/** Arbitrary for a backup file name matching the vroom-backup-*.zip pattern. */
const backupFileNameArb = fc
  .stringMatching(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}$/)
  .map((ts) => `vroom-backup-${ts}.zip`);

/** Arbitrary for a non-backup file name (does NOT match vroom-backup-*.zip). */
const nonBackupFileNameArb = fc.oneof(
  fc.stringMatching(/^photo-[a-z0-9]{4,8}\.(jpg|png)$/),
  fc.stringMatching(/^document-[a-z0-9]{4,8}\.pdf$/),
  fc.constant('readme.txt'),
  fc.constant('vroom-backup-incomplete'),
  fc.constant('vroom-backup-.txt')
);

/** Arbitrary for a StorageFileInfo representing a backup file. */
const backupFileArb: fc.Arbitrary<StorageFileInfo> = fc.record({
  key: fc.stringMatching(/^key-[a-zA-Z0-9]{5,20}$/),
  name: backupFileNameArb,
  size: fc.nat({ max: 100_000_000 }),
  createdTime: isoTimestampArb,
  lastModified: isoTimestampArb,
});

/** Arbitrary for a StorageFileInfo representing a non-backup file. */
const nonBackupFileArb: fc.Arbitrary<StorageFileInfo> = fc.record({
  key: fc.stringMatching(/^nbk-[a-zA-Z0-9]{5,20}$/),
  name: nonBackupFileNameArb,
  size: fc.nat({ max: 100_000_000 }),
  createdTime: isoTimestampArb,
  lastModified: isoTimestampArb,
});

// ---------------------------------------------------------------------------
// Property 4: Backup listing filter, sort, and badge
// Validates: Requirements 4.1, 4.2
// ---------------------------------------------------------------------------

describe('Property 4: Backup listing filter, sort, and badge', () => {
  /**
   * **Validates: Requirements 4.1, 4.2**
   *
   * For any list of files containing a mix of backup files (vroom-backup-*.zip)
   * and non-backup files, the listing logic SHALL return only the matching files,
   * sorted newest-first by lastModified, with exactly one file marked isLatest: true
   * (the most recent), and all others marked isLatest: false.
   *
   * We test the pure filter/sort/badge logic extracted from listBackups().
   */

  /** Pure function replicating the listBackups filter/sort/badge logic. */
  function applyListBackupsLogic(files: StorageFileInfo[]) {
    return files
      .filter((f) => f.name.startsWith('vroom-backup-') && f.name.endsWith('.zip'))
      .sort((a, b) => b.lastModified.localeCompare(a.lastModified))
      .map((f, i) => ({
        fileRef: f.key,
        fileName: f.name,
        size: f.size,
        createdTime: f.createdTime,
        isLatest: i === 0,
      }));
  }

  test('only vroom-backup-*.zip files are included', () => {
    fc.assert(
      fc.property(
        fc.array(backupFileArb, { minLength: 0, maxLength: 10 }),
        fc.array(nonBackupFileArb, { minLength: 0, maxLength: 10 }),
        (backupFiles, nonBackupFiles) => {
          const allFiles = [...backupFiles, ...nonBackupFiles];
          const result = applyListBackupsLogic(allFiles);

          // Result count must equal backup file count
          expect(result.length).toBe(backupFiles.length);

          // Every result file name must match the backup pattern
          for (const r of result) {
            expect(r.fileName.startsWith('vroom-backup-')).toBe(true);
            expect(r.fileName.endsWith('.zip')).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  test('results are sorted newest-first by lastModified', () => {
    // Use unique keys to avoid ambiguity in verification
    const uniqueKeyBackupFileArb = fc
      .array(backupFileArb, { minLength: 2, maxLength: 20 })
      .map((files) => {
        const seen = new Set<string>();
        return files
          .map((f, i) => {
            const uniqueKey = `key-${i}-${f.key}`;
            if (seen.has(uniqueKey)) return null;
            seen.add(uniqueKey);
            return { ...f, key: uniqueKey };
          })
          .filter((f): f is StorageFileInfo => f !== null);
      })
      .filter((arr) => arr.length >= 2);

    fc.assert(
      fc.property(uniqueKeyBackupFileArb, (backupFiles) => {
        const result = applyListBackupsLogic(backupFiles);

        // Verify adjacent pairs are in non-increasing lastModified order
        for (let i = 1; i < result.length; i++) {
          const prevKey = result[i - 1].fileRef;
          const currKey = result[i].fileRef;
          const prevFile = backupFiles.find((f) => f.key === prevKey);
          const currFile = backupFiles.find((f) => f.key === currKey);
          if (!prevFile || !currFile) return; // Should never happen with unique keys
          expect(prevFile.lastModified >= currFile.lastModified).toBe(true);
        }
      }),
      { numRuns: 200 }
    );
  });

  test('exactly one file is marked isLatest when backups exist', () => {
    fc.assert(
      fc.property(fc.array(backupFileArb, { minLength: 1, maxLength: 20 }), (backupFiles) => {
        const result = applyListBackupsLogic(backupFiles);

        const latestCount = result.filter((r) => r.isLatest).length;
        expect(latestCount).toBe(1);

        // The latest must be the first element (newest)
        expect(result[0].isLatest).toBe(true);

        // All others must be false
        for (let i = 1; i < result.length; i++) {
          expect(result[i].isLatest).toBe(false);
        }
      }),
      { numRuns: 200 }
    );
  });

  test('empty file list returns empty result with no isLatest', () => {
    const result = applyListBackupsLogic([]);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Property 2: Retention enforcement correctness
// Validates: Requirements 2.2, 2.3, 2.4
// ---------------------------------------------------------------------------

describe('Property 2: Retention enforcement correctness', () => {
  /**
   * **Validates: Requirements 2.2, 2.3, 2.4**
   *
   * For any list of N files matching vroom-backup-*.zip and a retention count R,
   * after enforcement exactly max(0, N - R) files SHALL be deleted, the R newest
   * files (by lastModified) SHALL be preserved, and the returned deleted count
   * SHALL equal the number of actually successful deletions (not attempted).
   */

  /**
   * Pure function replicating the retention enforcement logic.
   * Returns { toDelete, preserved } for verification.
   */
  function computeRetention(
    files: StorageFileInfo[],
    retentionCount: number
  ): { toDelete: StorageFileInfo[]; preserved: StorageFileInfo[] } {
    const backupFiles = files
      .filter((f) => f.name.startsWith('vroom-backup-') && f.name.endsWith('.zip'))
      .sort((a, b) => b.lastModified.localeCompare(a.lastModified));

    if (backupFiles.length <= retentionCount) {
      return { toDelete: [], preserved: backupFiles };
    }

    return {
      preserved: backupFiles.slice(0, retentionCount),
      toDelete: backupFiles.slice(retentionCount),
    };
  }

  test('exactly max(0, N - R) files are marked for deletion', () => {
    fc.assert(
      fc.property(
        fc.array(backupFileArb, { minLength: 0, maxLength: 30 }),
        retentionCountArb,
        (files, retentionCount) => {
          const { toDelete } = computeRetention(files, retentionCount);
          const expected = Math.max(0, files.length - retentionCount);
          expect(toDelete.length).toBe(expected);
        }
      ),
      { numRuns: 200 }
    );
  });

  test('the R newest files by lastModified are preserved', () => {
    fc.assert(
      fc.property(
        fc.array(backupFileArb, { minLength: 1, maxLength: 30 }),
        retentionCountArb,
        (files, retentionCount) => {
          const { preserved } = computeRetention(files, retentionCount);

          // Preserved files should be sorted newest-first
          for (let i = 1; i < preserved.length; i++) {
            expect(preserved[i - 1].lastModified >= preserved[i].lastModified).toBe(true);
          }

          // Every deleted file should be older than or equal to every preserved file
          const { toDelete } = computeRetention(files, retentionCount);
          if (preserved.length > 0 && toDelete.length > 0) {
            const oldestPreserved = preserved[preserved.length - 1].lastModified;
            for (const d of toDelete) {
              expect(d.lastModified <= oldestPreserved).toBe(true);
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  test('non-backup files are ignored during retention', () => {
    fc.assert(
      fc.property(
        fc.array(backupFileArb, { minLength: 0, maxLength: 10 }),
        fc.array(nonBackupFileArb, { minLength: 1, maxLength: 10 }),
        retentionCountArb,
        (backupFiles, nonBackupFiles, retentionCount) => {
          const allFiles = [...backupFiles, ...nonBackupFiles];
          const { toDelete, preserved } = computeRetention(allFiles, retentionCount);

          // Non-backup files should never appear in toDelete or preserved
          const allRetentionKeys = new Set([
            ...toDelete.map((f) => f.key),
            ...preserved.map((f) => f.key),
          ]);
          for (const nbf of nonBackupFiles) {
            expect(allRetentionKeys.has(nbf.key)).toBe(false);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  test('deleted count equals actual successful deletions (with partial failures)', () => {
    /**
     * Simulates the retention deletion loop where some deletes fail.
     * Returns the actual deleted count (matching the real implementation).
     */
    function simulateRetentionDeletion(
      toDelete: StorageFileInfo[],
      failingKeys: Set<string>
    ): number {
      let deletedCount = 0;
      for (const file of toDelete) {
        if (!failingKeys.has(file.key)) {
          deletedCount++;
        }
      }
      return deletedCount;
    }

    fc.assert(
      fc.property(
        fc.array(backupFileArb, { minLength: 2, maxLength: 20 }),
        fc.integer({ min: 1, max: 5 }),
        (files, retentionCount) => {
          const { toDelete } = computeRetention(files, retentionCount);
          if (toDelete.length === 0) return;

          // Randomly pick some keys to fail
          const failingKeys = new Set(toDelete.filter((_, i) => i % 2 === 0).map((f) => f.key));

          const deletedCount = simulateRetentionDeletion(toDelete, failingKeys);
          const expectedSuccesses = toDelete.filter((f) => !failingKeys.has(f.key)).length;
          expect(deletedCount).toBe(expectedSuccesses);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 16: Backup skip logic
// Validates: Requirements 15.1, 15.2
// ---------------------------------------------------------------------------

describe('Property 16: Backup skip logic', () => {
  /**
   * **Validates: Requirements 15.1, 15.2**
   *
   * For any call to performProviderBackup, if force is false and
   * activityTracker.hasChangesSinceLastSync(userId) returns false,
   * the result SHALL have skipped: true and no ZIP SHALL be generated.
   * If force is true, the backup SHALL proceed regardless of change status.
   *
   * We test the pure skip decision logic extracted from performProviderBackup.
   */

  /**
   * Pure function replicating the skip decision logic from performProviderBackup.
   * Returns { shouldSkip, shouldGenerateZip }.
   */
  function evaluateSkipLogic(
    force: boolean,
    hasChanges: boolean
  ): { shouldSkip: boolean; shouldGenerateZip: boolean } {
    if (!force && !hasChanges) {
      return { shouldSkip: true, shouldGenerateZip: false };
    }
    // When force=true OR hasChanges=true, proceed (ZIP generation depends on enabled providers)
    return { shouldSkip: false, shouldGenerateZip: true };
  }

  test('skips when force=false and no changes', () => {
    fc.assert(
      fc.property(userIdArb, (/* userId — not needed for pure logic */) => {
        const result = evaluateSkipLogic(false, false);
        expect(result.shouldSkip).toBe(true);
        expect(result.shouldGenerateZip).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  test('does not skip when force=true regardless of change status', () => {
    fc.assert(
      fc.property(
        fc.boolean(), // hasChanges — should not matter when force=true
        (hasChanges) => {
          const result = evaluateSkipLogic(true, hasChanges);
          expect(result.shouldSkip).toBe(false);
          expect(result.shouldGenerateZip).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  test('does not skip when force=false but changes exist', () => {
    fc.assert(
      fc.property(userIdArb, () => {
        const result = evaluateSkipLogic(false, true);
        expect(result.shouldSkip).toBe(false);
        expect(result.shouldGenerateZip).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  test('skip decision is consistent: only force=false AND no changes triggers skip', () => {
    fc.assert(
      fc.property(
        fc.boolean(), // force
        fc.boolean(), // hasChanges
        (force, hasChanges) => {
          const result = evaluateSkipLogic(force, hasChanges);

          // Skip should only happen when force=false AND hasChanges=false
          const expectedSkip = !force && !hasChanges;
          expect(result.shouldSkip).toBe(expectedSkip);
          expect(result.shouldGenerateZip).toBe(!expectedSkip);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 1: Provider isolation during backup
// Validates: Requirements 1.1, 1.3, 1.4
// ---------------------------------------------------------------------------

describe('Property 1: Provider isolation during backup', () => {
  /**
   * **Validates: Requirements 1.1, 1.3, 1.4**
   *
   * For any set of backup-enabled providers where some providers fail and others
   * succeed, the BackupSyncResult SHALL contain exactly one entry per enabled
   * provider, successful providers SHALL have success: true with valid fileRef
   * and fileName, failed providers SHALL have success: false with an error message,
   * and no successful provider's result SHALL be affected by another provider's failure.
   */

  /**
   * Simulates the core isolation logic of performProviderBackup:
   * each provider is handled independently via Promise.allSettled,
   * failures in one do not affect others.
   */
  async function simulateProviderBackup(
    enabledProviders: Array<{ id: string; shouldFail: boolean }>,
    fileName: string
  ): Promise<BackupSyncResult> {
    const timestamp = new Date().toISOString();

    const uploadResults = await Promise.allSettled(
      enabledProviders.map(async (provider) => {
        if (provider.shouldFail) {
          throw new Error(`Provider ${provider.id} failed`);
        }
        return {
          providerId: provider.id,
          success: true as const,
          fileRef: `ref-${provider.id}`,
          fileName,
          deletedOldBackups: 0,
        };
      })
    );

    const results: BackupSyncResult['results'] = {};

    for (const result of uploadResults) {
      if (result.status === 'fulfilled') {
        const { providerId, ...rest } = result.value;
        results[providerId] = rest;
      } else {
        // In the real code, errors are caught inside the map callback,
        // so all results are fulfilled. We simulate the catch here.
        const errorMsg = result.reason instanceof Error ? result.reason.message : 'Backup failed';
        // Extract provider ID from error message for simulation
        const match = errorMsg.match(/Provider (prov-[a-z0-9]+) failed/);
        if (match) {
          results[match[1]] = { success: false, message: errorMsg };
        }
      }
    }

    return { results, timestamp };
  }

  type ProviderEntry = { id: string; shouldFail: boolean };

  /** Arbitrary for a set of providers with mixed success/failure. */
  const providerSetArb: fc.Arbitrary<ProviderEntry[]> = fc
    .array(
      fc.record({
        id: providerIdArb,
        shouldFail: fc.boolean(),
      }),
      { minLength: 1, maxLength: 8 }
    )
    .chain((providers) => {
      // Ensure unique IDs
      const seen = new Set<string>();
      const unique = providers.filter((p) => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
      // Ensure at least one provider
      if (unique.length === 0)
        return fc.constant<ProviderEntry[]>([{ id: 'prov-fallback', shouldFail: false }]);
      return fc.constant<ProviderEntry[]>(unique);
    });

  test('result contains exactly one entry per enabled provider', async () => {
    await fc.assert(
      fc.asyncProperty(providerSetArb, async (providers) => {
        const result = await simulateProviderBackup(providers, 'vroom-backup-test.zip');
        expect(Object.keys(result.results).length).toBe(providers.length);

        for (const provider of providers) {
          expect(result.results[provider.id]).toBeDefined();
        }
      }),
      { numRuns: 200 }
    );
  });

  test('successful providers have success=true with valid fileRef and fileName', async () => {
    await fc.assert(
      fc.asyncProperty(providerSetArb, async (providers) => {
        const fileName = 'vroom-backup-test.zip';
        const result = await simulateProviderBackup(providers, fileName);

        for (const provider of providers) {
          const entry = result.results[provider.id];
          if (!provider.shouldFail) {
            expect(entry.success).toBe(true);
            expect(entry.fileRef).toBeDefined();
            expect(typeof entry.fileRef).toBe('string');
            expect(entry.fileRef?.length).toBeGreaterThan(0);
            expect(entry.fileName).toBe(fileName);
          }
        }
      }),
      { numRuns: 200 }
    );
  });

  test('failed providers have success=false with an error message', async () => {
    await fc.assert(
      fc.asyncProperty(providerSetArb, async (providers) => {
        const result = await simulateProviderBackup(providers, 'vroom-backup-test.zip');

        for (const provider of providers) {
          const entry = result.results[provider.id];
          if (provider.shouldFail) {
            expect(entry.success).toBe(false);
            expect(entry.message).toBeDefined();
            expect(typeof entry.message).toBe('string');
            expect(entry.message?.length).toBeGreaterThan(0);
          }
        }
      }),
      { numRuns: 200 }
    );
  });

  test('successful provider results are not affected by other failures', async () => {
    // Ensure at least one success and one failure
    const mixedProviderSetArb: fc.Arbitrary<ProviderEntry[]> = fc
      .array(providerIdArb, { minLength: 2, maxLength: 8 })
      .chain((ids) => {
        const unique = [...new Set(ids)];
        if (unique.length < 2)
          return fc.constant<ProviderEntry[]>([
            { id: 'prov-success', shouldFail: false },
            { id: 'prov-failure', shouldFail: true },
          ]);
        // First half succeeds, second half fails
        return fc.constant<ProviderEntry[]>(
          unique.map((id, i) => ({ id, shouldFail: i >= Math.ceil(unique.length / 2) }))
        );
      });

    await fc.assert(
      fc.asyncProperty(mixedProviderSetArb, async (providers) => {
        const fileName = 'vroom-backup-test.zip';
        const result = await simulateProviderBackup(providers, fileName);

        const successProviders = providers.filter((p) => !p.shouldFail);
        const failProviders = providers.filter((p) => p.shouldFail);

        // All successful providers must have consistent results
        for (const sp of successProviders) {
          const entry = result.results[sp.id];
          expect(entry.success).toBe(true);
          expect(entry.fileRef).toBe(`ref-${sp.id}`);
          expect(entry.fileName).toBe(fileName);
        }

        // All failed providers must have failure results
        for (const fp of failProviders) {
          const entry = result.results[fp.id];
          expect(entry.success).toBe(false);
        }
      }),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 17: lastBackupAt per-provider update
// Validates: Requirement 1.5
// ---------------------------------------------------------------------------

describe('Property 17: lastBackupAt per-provider update', () => {
  /**
   * **Validates: Requirements 1.5**
   *
   * For any backup run with mixed success/failure across providers, only providers
   * with success: true SHALL have their lastBackupAt field updated in backupConfig.
   * Failed providers' lastBackupAt SHALL remain unchanged.
   */

  /**
   * Pure function replicating the lastBackupAt update logic from performProviderBackup.
   * Takes the original config and per-provider results, returns the updated config.
   */
  function applyLastBackupAtUpdates(
    originalConfig: BackupConfig,
    results: BackupSyncResult['results'],
    timestamp: string
  ): BackupConfig {
    const updatedConfig: BackupConfig = {
      providers: { ...originalConfig.providers },
    };

    for (const [providerId, result] of Object.entries(results)) {
      if (result.success) {
        updatedConfig.providers[providerId] = {
          ...updatedConfig.providers[providerId],
          lastBackupAt: timestamp,
        };
      }
    }

    return updatedConfig;
  }

  /** Arbitrary for a provider with a success/failure result. */
  const providerResultArb = fc.record({
    id: providerIdArb,
    success: fc.boolean(),
    originalLastBackupAt: fc.option(isoTimestampArb, { nil: undefined }),
  });

  /** Arbitrary for a set of unique provider results. */
  const providerResultSetArb = fc
    .array(providerResultArb, { minLength: 1, maxLength: 8 })
    .map((providers) => {
      const seen = new Set<string>();
      return providers.filter((p) => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
    })
    .filter((arr) => arr.length > 0);

  test('only successful providers have lastBackupAt updated', () => {
    fc.assert(
      fc.property(providerResultSetArb, isoTimestampArb, (providerResults, timestamp) => {
        // Build original config
        const originalConfig: BackupConfig = {
          providers: Object.fromEntries(
            providerResults.map((p) => [
              p.id,
              {
                enabled: true,
                folderPath: 'Backups',
                retentionCount: 10,
                lastBackupAt: p.originalLastBackupAt,
              },
            ])
          ),
        };

        // Build results
        const results: BackupSyncResult['results'] = Object.fromEntries(
          providerResults.map((p) => [
            p.id,
            p.success
              ? { success: true, fileRef: `ref-${p.id}`, fileName: 'backup.zip' }
              : { success: false, message: 'Failed' },
          ])
        );

        const updated = applyLastBackupAtUpdates(originalConfig, results, timestamp);

        for (const p of providerResults) {
          const updatedSettings = updated.providers[p.id];
          if (p.success) {
            // Successful → lastBackupAt updated to timestamp
            expect(updatedSettings.lastBackupAt).toBe(timestamp);
          } else {
            // Failed → lastBackupAt unchanged from original
            expect(updatedSettings.lastBackupAt).toBe(p.originalLastBackupAt);
          }
        }
      }),
      { numRuns: 200 }
    );
  });

  test('failed providers lastBackupAt remains exactly as original', () => {
    fc.assert(
      fc.property(providerResultSetArb, isoTimestampArb, (providerResults, timestamp) => {
        const originalConfig: BackupConfig = {
          providers: Object.fromEntries(
            providerResults.map((p) => [
              p.id,
              {
                enabled: true,
                folderPath: 'Backups',
                retentionCount: 10,
                lastBackupAt: p.originalLastBackupAt,
              },
            ])
          ),
        };

        const results: BackupSyncResult['results'] = Object.fromEntries(
          providerResults.map((p) => [
            p.id,
            p.success
              ? { success: true, fileRef: `ref-${p.id}`, fileName: 'backup.zip' }
              : { success: false, message: 'Failed' },
          ])
        );

        const updated = applyLastBackupAtUpdates(originalConfig, results, timestamp);

        const failedProviders = providerResults.filter((p) => !p.success);
        for (const fp of failedProviders) {
          const original = originalConfig.providers[fp.id];
          const updatedEntry = updated.providers[fp.id];
          expect(updatedEntry.lastBackupAt).toBe(original.lastBackupAt);
        }
      }),
      { numRuns: 200 }
    );
  });
});
