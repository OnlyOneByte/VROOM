/**
 * #100 (C170 deep-review) — userPreferences read-modify-write (RMW) inventory guard.
 *
 * C168 introduced `PreferencesRepository.mergeJsonField` (atomic `json_patch` UPDATE) and converted the
 * cleanest race site (`cleanupBackupConfig`) to it. This deep-review CERTIFIED firsthand that the atomic
 * primitive is correct (pinned by prefs-atomic-merge.test.ts) and CENSUSED every remaining write to the
 * JSON config columns (`storageConfig` / `backupConfig`) on `userPreferences`. Result: exactly FOUR RMW
 * sites remain, ALL already-tracked #100 follow-ups (none a C168 regression):
 *   1. settings/routes.ts settings-PUT merge — validates the MERGED result between read and write + uses
 *      the bespoke #82 per-provider merge; atomic-patch swap needs care (validation ordering). Tracked.
 *   2. providers/routes.ts provider-create storageConfig auto-populate — RMW.
 *   3. providers/routes.ts cleanupStorageConfig — a read-DEPENDENT edit (null a default ONLY if it points
 *      at the deleted provider); can't be a pure static patch — stays RMW (or needs a split). Tracked.
 *   4. sync/backup-orchestrator.ts auto-backup — wholesale write of the whole backupConfig from a stale
 *      read; pre-exists #100, NOT a C168 regression. Tracked.
 *
 * This is a SOURCE-SCAN drift guard (the C25/C45/C94 pattern): it pins the exact count of RMW
 * `preferencesRepository.update(...)` calls carrying a JSON config column, so a NEW unguarded RMW write
 * (the lost-update footgun) can't be added silently — it trips this test, forcing the author to either use
 * the atomic `mergeJsonField` or consciously add the site to the tracked-remaining inventory here.
 */

import { describe, expect, test } from 'bun:test';

/**
 * Count `preferencesRepository.update(...)` RMW calls in one file. Every such call on a route that owns a
 * JSON config column is a potential #100 lost-update site (read-modify-write); the atomic `mergeJsonField`
 * is the safe replacement and is NOT counted. The per-file count is the drift signal: a NEW `.update(` call
 * (or removing one without converting it) trips the exact-count assertions below.
 */
async function countRmwUpdates(relPath: string): Promise<number> {
  const src = await Bun.file(`${import.meta.dir}/../../../${relPath}`).text();
  return (src.match(/preferencesRepository\.update\(/g) ?? []).length;
}

describe('#100 userPreferences RMW inventory (C170 deep-review drift guard)', () => {
  // C170 census: exactly 4 RMW `preferencesRepository.update` sites remain across the codebase, ALL
  // already-tracked #100 follow-ups. C168 converted the 5th (cleanupBackupConfig) to atomic mergeJsonField.
  test('settings-PUT has exactly ONE RMW update (the tracked validation-coupled merge follow-up)', async () => {
    // settings/routes.ts:287 — writes the merged {storageConfig, backupConfig, ...} after validating the
    // MERGED result; an atomic-patch swap needs validation-ordering care. Tracked in BACKLOG #100.
    expect(await countRmwUpdates('api/settings/routes.ts')).toBe(1);
  });

  test('providers routes have exactly TWO RMW updates (create auto-populate + cleanupStorageConfig)', async () => {
    // Both write storageConfig. cleanupStorageConfig is read-DEPENDENT (null a default only if it points at
    // the deleted provider) → can't be a pure static patch. The THIRD provider config write
    // (cleanupBackupConfig) was converted to the atomic mergeJsonField in C168 — NOT counted (the point).
    expect(await countRmwUpdates('api/providers/routes.ts')).toBe(2);
  });

  test('backup-orchestrator has exactly ONE RMW update (the pre-existing wholesale auto-backup write)', async () => {
    // backup-orchestrator.ts:209 — wholesale backupConfig write from a stale read. Pre-exists #100; NOT a
    // C168 regression. A concurrent provider-delete (now atomic) could be clobbered by this stale write —
    // the remaining #100 surface, tracked. (The backup mutex serializes backup RUNS, not provider-deletes.)
    expect(await countRmwUpdates('api/sync/backup-orchestrator.ts')).toBe(1);
  });

  test('cleanupBackupConfig now uses the ATOMIC mergeJsonField, not an RMW update', async () => {
    const src = await Bun.file(`${import.meta.dir}/../../providers/routes.ts`).text();
    const start = src.indexOf('async function cleanupBackupConfig');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, start + 600);
    expect(body).toContain("mergeJsonField(userId, 'backupConfig'");
    // It must NOT have regressed to a read-modify-write update of backupConfig.
    expect(body).not.toMatch(/preferencesRepository\.update\([^)]*backupConfig/);
  });
});
