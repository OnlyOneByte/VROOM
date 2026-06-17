/**
 * #136 (C446 deep-review→bug): the activityTracker middleware must arm the inactivity timer for a
 * Sheets-only-sync provider (enabled:false, sheetsSyncEnabled:true), not just enabled-ZIP providers.
 *
 * The middleware gated `hasSyncEnabled` on `.some((p) => p.enabled)` — NARROWER than the orchestrator's
 * own predicate filterEnabledProviders (`s.enabled || s.sheetsSyncEnabled === true`), which the backup
 * run actually fans out on. So a user who turned on Sheets sync only (ZIP off) + syncOnInactivity never
 * armed the timer → recordActivity was never called → auto-backup-on-inactivity SILENTLY never fired,
 * even though the orchestrator it gates WOULD have backed up to Sheets. The fix routes the middleware
 * through filterEnabledProviders (ONE source of truth for "would back up"). This drives the REAL
 * middleware through the HTTP harness (it's mounted app-wide) + spies the exported tracker singleton.
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createTestApp, json, type TestApp } from '../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

function seedProvider(id: string, displayName: string): void {
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
     VALUES (?, ?, 'storage', 'google-drive', ?, '', 'active')`,
    [id, ctx.user.id, displayName]
  );
}

describe('activityTracker arms the inactivity timer for a Sheets-only-sync provider (#136)', () => {
  test('a Sheets-only provider (enabled:false, sheetsSyncEnabled:true) + syncOnInactivity → recordActivity fires', async () => {
    seedProvider('drive-sheets', 'Drive (Sheets only)');

    // Configure: ZIP backup OFF, Sheets sync ON, and auto-sync-on-inactivity ON.
    const put = await ctx.authed('PUT', '/api/v1/settings', {
      syncOnInactivity: true,
      syncInactivityMinutes: 30, // max allowed; the spy makes recordActivity a no-op so nothing fires in-test
      backupConfig: {
        providers: {
          'drive-sheets': {
            enabled: false,
            folderPath: '/Backups/sheets',
            retentionCount: 7,
            sheetsSyncEnabled: true,
          },
        },
      },
    });
    expect(put.status, await put.text()).toBeLessThan(300);

    // Spy AFTER the settings PUT (that PUT is itself a tracked write; we want to observe the NEXT write).
    // Dynamic-import the tracker singleton AFTER createTestApp bound the DB to :memory: (C291/C300) — a
    // top-level import would bind the DB singleton before the harness rewrites DATABASE_URL.
    const { activityTracker: userActivityTracker } = await import(
      '../../api/sync/activity-tracker'
    );
    const spy = spyOn(userActivityTracker, 'recordActivity');
    try {
      // Any authed mutating /api/ request runs the app-wide activityTracker middleware post-response.
      const write = await ctx.authed('POST', '/api/v1/vehicles', {
        make: 'Honda',
        model: 'X',
        year: 2021,
      });
      const body = await json<{ success: boolean }>(write);
      expect(write.status, JSON.stringify(body)).toBeLessThan(300);

      // NON-VACUOUS: pre-fix the narrow `.some(p.enabled)` gate was false for a Sheets-only provider, so
      // recordActivity was NEVER called. Post-fix (filterEnabledProviders) it arms for the user.
      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0]?.[0]).toBe(ctx.user.id);
    } finally {
      spy.mockRestore();
    }
  });
});
