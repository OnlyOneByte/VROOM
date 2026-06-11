/**
 * Characterization tests for settings ROUTE error behavior through the REAL HTTP stack (arch #1
 * part 2c prerequisite — characterize-then-drop, cycle 43).
 *
 * Unlike the sync routes (handleSyncError), the settings handlers hand-roll try/catch that rethrow
 * as AppError with TRANSFORMED messages: GET / masks any error as AppError('Failed to fetch
 * settings', 500); PUT / maps a ZodError → AppError('Invalid settings data', 400) and re-throws an
 * AppError as-is; POST /backup + /restore wrap as 500. The central errorHandler already shapes
 * AppError by its statusCode, so most of this is boilerplate — BUT the GET catch MASKS typed errors
 * (a NotFoundError/ValidationError would surface as a generic 500), and the PUT ZodError→400 is a
 * message transform. Dropping the try/catch therefore CHANGES some responses (a real improvement —
 * typed errors reach their proper status — but a behavior change), so per arch rule 2/3 this cycle
 * PINS today's behavior; the drop + assertion updates land in the next arch cycle (part 2c-drop).
 *
 * createTestApp() rewrites env then dynamic-imports DB-bound modules; keep imports to harness +
 * bun:test.
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

describe('settings route error behavior (characterization — pins today before the arch drop)', () => {
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
    // maxSyncInactivityMinutes is 30 (config); 9999 fails the schema → ZodError.
    const res = await ctx.authed('PUT', '/api/v1/settings', { syncInactivityMinutes: 9999 });
    expect(res.status).toBe(400);
    const body = (await json<ErrorBody>(res)) as ErrorBody;
    expect(body.success).toBe(false);
    // POST-DROP (C50): the hand-rolled try/catch is gone, so the ZodError reaches the central
    // errorHandler → 400 ValidationError ('Invalid request data'), the standard envelope. Status is
    // unchanged (still 400); only the transformed 'Invalid settings data' message went away. This is
    // the authorized, reviewed behavior change the C43 characterization flagged.
    expect(body.error.message, 'post-drop: central errorHandler ZodError message').toBe(
      'Invalid request data'
    );
  });

  test('PUT /settings with a malformed backupConfig (path traversal) → 400', async () => {
    // providerBackupSettingsSchema rejects a folderPath containing '..' → ZodError → same 400 path.
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
