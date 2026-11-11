/**
 * Settings route error responses through the HTTP stack. Validation failures must come back as 400
 * through the central error handler.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, json, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface ErrorBody {
  success: boolean;
  error: { code: string; message: string; details?: unknown };
}

describe('settings route error responses', () => {
  test('GET /settings returns the user prefs (positive control)', async () => {
    const res = await ctx.authed('GET', '/api/v1/settings');
    expect(res.status).toBe(200);
    const body = (await json<{ success: boolean; data: { userId: string } }>(res)) as {
      success: boolean;
      data: { userId: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.userId).toBe(ctx.user.id);
  });

  test('PUT /settings with an out-of-range syncInactivityMinutes → 400 (ZodError path)', async () => {
    const res = await ctx.authed('PUT', '/api/v1/settings', { syncInactivityMinutes: 9999 });
    expect(res.status).toBe(400);
    const body = (await json<ErrorBody>(res)) as ErrorBody;
    expect(body.success).toBe(false);
    expect(body.error.message, 'central error handler maps ZodError to this message').toBe(
      'Invalid request data'
    );
  });

  test('PUT /settings with a malformed backupConfig (path traversal) → 400', async () => {
    const res = await ctx.authed('PUT', '/api/v1/settings', {
      backupConfig: {
        providers: {
          p1: { enabled: true, folderPath: '../etc/passwd', retentionCount: 5 },
        },
      },
    });
    expect(res.status).toBe(400);
    const body = (await json<ErrorBody>(res)) as ErrorBody;
    expect(body.success).toBe(false);
  });

  test('PUT /settings with a valid partial update succeeds (positive control)', async () => {
    const res = await ctx.authed('PUT', '/api/v1/settings', { syncInactivityMinutes: 15 });
    expect(res.status).toBe(200);
    const body = (await json<{ success: boolean; data: { syncInactivityMinutes: number } }>(
      res
    )) as { success: boolean; data: { syncInactivityMinutes: number } };
    expect(body.success).toBe(true);
    expect(body.data.syncInactivityMinutes).toBe(15);
  });
});

/**
 * POST /settings/backup writes sync_state.last_backup_date, which the backup-status UI reads, so the
 * test checks the row and not only the response.
 */
describe('settings POST /backup', () => {
  function backupDateRow(userId: string): { last_backup_date: number | null } | undefined {
    return ctx.sqlite
      .query('SELECT last_backup_date FROM sync_state WHERE user_id = ?')
      .get(userId) as { last_backup_date: number | null } | undefined;
  }

  test('POST /settings/backup returns 200 and stamps sync_state.last_backup_date', async () => {
    await ctx.authed('GET', '/api/v1/settings');
    const before = backupDateRow(ctx.user.id);
    expect(before?.last_backup_date ?? null).toBeNull();

    const res = await ctx.authed('POST', '/api/v1/settings/backup');
    expect(res.status).toBe(200);
    const body = await json<{ success: boolean; timestamp: string }>(res);
    expect(body.success).toBe(true);
    expect(typeof body.timestamp).toBe('string');

    const after = backupDateRow(ctx.user.id);
    expect(after?.last_backup_date).toBeTruthy();
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect((after?.last_backup_date as number) <= nowSeconds + 5).toBe(true);
  });

  test('POST /settings/backup requires auth (401 when anonymous)', async () => {
    expect((await ctx.anon('POST', '/api/v1/settings/backup')).status).toBe(401);
  });

  test('POST /settings/restore is not served, so it cannot report a restore that never ran', async () => {
    expect((await ctx.authed('POST', '/api/v1/settings/restore')).status).toBe(404);
  });
});
