// A sheets-only-sync provider (enabled:false, sheetsSyncEnabled:true) must arm the inactivity timer,
// matching the orchestrator's own "would back up" predicate.

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

describe('activityTracker arms the inactivity timer for a Sheets-only-sync provider', () => {
  test('a Sheets-only provider (enabled:false, sheetsSyncEnabled:true) + syncOnInactivity → recordActivity fires', async () => {
    seedProvider('drive-sheets', 'Drive (Sheets only)');

    const put = await ctx.authed('PUT', '/api/v1/settings', {
      syncOnInactivity: true,
      syncInactivityMinutes: 30,
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

    const { activityTracker: userActivityTracker } = await import(
      '../../api/sync/activity-tracker'
    );
    const spy = spyOn(userActivityTracker, 'recordActivity');
    try {
      const write = await ctx.authed('POST', '/api/v1/vehicles', {
        make: 'Honda',
        model: 'X',
        year: 2021,
      });
      const body = await json<{ success: boolean }>(write);
      expect(write.status, JSON.stringify(body)).toBeLessThan(300);

      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0]?.[0]).toBe(ctx.user.id);
    } finally {
      spy.mockRestore();
    }
  });
});
