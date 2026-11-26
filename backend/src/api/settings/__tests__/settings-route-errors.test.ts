import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
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

describe('settings POST /restore', () => {
  test('POST /settings/restore is not served, so it cannot report a restore that never ran', async () => {
    expect((await ctx.authed('POST', '/api/v1/settings/restore')).status).toBe(404);
  });
});
