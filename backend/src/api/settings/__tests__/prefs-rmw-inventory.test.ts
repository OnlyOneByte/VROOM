/**
 * Drift guard for read-modify-write updates of the JSON config columns on user_preferences. Those
 * updates can lose concurrent writes, so the exact count of such call sites is pinned here. A new
 * one should use the atomic mergeJsonField instead, or update the count deliberately.
 */

import { describe, expect, test } from 'bun:test';

async function countRmwUpdates(relPath: string): Promise<number> {
  const src = await Bun.file(`${import.meta.dir}/../../../${relPath}`).text();
  return (src.match(/preferencesRepository\.update\(/g) ?? []).length;
}

describe('userPreferences RMW inventory', () => {
  test('settings PUT keeps exactly one read-modify-write update', async () => {
    // Writes the merged config after validating the merged result.
    expect(await countRmwUpdates('api/settings/routes.ts')).toBe(1);
  });

  test('providers routes keep exactly two read-modify-write updates', async () => {
    // cleanupStorageConfig depends on the current value, so it cannot be a static patch.
    expect(await countRmwUpdates('api/providers/routes.ts')).toBe(2);
  });

  test('backup orchestrator has no read-modify-write update', async () => {
    expect(await countRmwUpdates('api/sync/backup-orchestrator.ts')).toBe(0);
  });

  test('cleanupBackupConfig uses the atomic mergeJsonField, not a read-modify-write update', async () => {
    const src = await Bun.file(`${import.meta.dir}/../../providers/routes.ts`).text();
    const start = src.indexOf('async function cleanupBackupConfig');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, start + 600);
    expect(body).toContain("mergeJsonField(userId, 'backupConfig'");
    expect(body).not.toMatch(/preferencesRepository\.update\([^)]*backupConfig/);
  });
});
