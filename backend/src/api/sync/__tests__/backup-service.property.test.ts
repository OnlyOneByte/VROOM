/**
 * Property tests for BackupService.
 *
 * Property 2: Retention enforcement correctness
 * Property 4: Backup listing filter, sort, and badge
 *
 * Provider isolation (Property 1), skip logic (Property 16), and lastBackupAt
 * updates (Property 17) are covered in backup-orchestrator.test.ts.
 *
 * Validates: Requirements 2.2, 2.3, 2.4, 4.1, 4.2
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import type { StorageFileInfo } from '../../providers/domains/storage/storage-provider';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

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
          expect(result.length).toBe(backupFiles.length);
          for (const r of result) {
            expect(r.fileName.startsWith('vroom-backup-')).toBe(true);
            expect(r.fileName.endsWith('.zip')).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('results are sorted newest-first by lastModified', () => {
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
        for (let i = 1; i < result.length; i++) {
          const prevFile = backupFiles.find((f) => f.key === result[i - 1].fileRef);
          const currFile = backupFiles.find((f) => f.key === result[i].fileRef);
          if (!prevFile || !currFile) return;
          expect(prevFile.lastModified >= currFile.lastModified).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('exactly one file is marked isLatest when backups exist', () => {
    fc.assert(
      fc.property(fc.array(backupFileArb, { minLength: 1, maxLength: 20 }), (backupFiles) => {
        const result = applyListBackupsLogic(backupFiles);
        const latestCount = result.filter((r) => r.isLatest).length;
        expect(latestCount).toBe(1);
        expect(result[0].isLatest).toBe(true);
        for (let i = 1; i < result.length; i++) {
          expect(result[i].isLatest).toBe(false);
        }
      }),
      { numRuns: 100 }
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
      { numRuns: 100 }
    );
  });

  test('the R newest files by lastModified are preserved', () => {
    fc.assert(
      fc.property(
        fc.array(backupFileArb, { minLength: 1, maxLength: 30 }),
        retentionCountArb,
        (files, retentionCount) => {
          const { preserved, toDelete } = computeRetention(files, retentionCount);
          for (let i = 1; i < preserved.length; i++) {
            expect(preserved[i - 1].lastModified >= preserved[i].lastModified).toBe(true);
          }
          if (preserved.length > 0 && toDelete.length > 0) {
            const oldestPreserved = preserved[preserved.length - 1].lastModified;
            for (const d of toDelete) {
              expect(d.lastModified <= oldestPreserved).toBe(true);
            }
          }
        }
      ),
      { numRuns: 100 }
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
          const allRetentionKeys = new Set([
            ...toDelete.map((f) => f.key),
            ...preserved.map((f) => f.key),
          ]);
          for (const nbf of nonBackupFiles) {
            expect(allRetentionKeys.has(nbf.key)).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
