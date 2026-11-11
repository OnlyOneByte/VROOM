// POST /sync/restore/from-provider's preconditions, over the real route and in-memory DB. The route
// requires an Idempotency-Key header, which the shared harness cannot set, so requests go through
// app.request directly. A ZIP restore needs a live provider download, so its restore orchestration
// is covered by the restore-* suites, which drive restoreFromBackup with a real archive.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, json, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface ErrorBody {
  success: boolean;
  error: { code: string; message: string };
}

function seedProvider(id: string, userId: string, status = 'active'): void {
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', 'google-drive', 'Drive', 'enc', '{}', ?)`,
    [id, userId, status]
  );
}

function seedBackupConfig(providers: Record<string, unknown>): void {
  ctx.sqlite.run('INSERT OR REPLACE INTO user_preferences (user_id, backup_config) VALUES (?, ?)', [
    ctx.user.id,
    JSON.stringify({ providers }),
  ]);
}

/** POSTs to the restore route with a fresh Idempotency-Key, as a browser would. */
async function postFromProvider(body: unknown): Promise<Response> {
  return ctx.app.request('/api/v1/sync/restore/from-provider', {
    method: 'POST',
    headers: {
      Cookie: ctx.cookie,
      'Sec-Fetch-Site': 'same-origin',
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

const sheetsRestore = (providerId: string) => ({
  sourceType: 'sheets',
  providerId,
  mode: 'preview',
});

describe('POST /sync/restore/from-provider: provider lookup', () => {
  test('an unknown provider id is rejected as not found', async () => {
    const res = await postFromProvider(sheetsRestore('prov-missing'));
    const body = await json<ErrorBody>(res);
    expect(res.status).toBe(400);
    expect(body.error.message).toBe('Provider not found or inactive');
  });

  test('an inactive provider is rejected as not found', async () => {
    seedProvider('prov-inactive', ctx.user.id, 'inactive');
    const res = await postFromProvider(sheetsRestore('prov-inactive'));
    const body = await json<ErrorBody>(res);
    expect(res.status).toBe(400);
    expect(body.error.message).toBe('Provider not found or inactive');
  });

  test("another user's provider is rejected as not found", async () => {
    ctx.sqlite.run(
      "INSERT INTO users (id, email, display_name) VALUES ('other-user', 'other@example.com', 'Other')"
    );
    seedProvider('prov-foreign', 'other-user');
    const res = await postFromProvider(sheetsRestore('prov-foreign'));
    const body = await json<ErrorBody>(res);
    expect(res.status).toBe(400);
    expect(body.error.message).toBe('Provider not found or inactive');
  });
});

describe('POST /sync/restore/from-provider: Sheets source precondition', () => {
  test('an active provider with no spreadsheet id is rejected before any Sheets call', async () => {
    seedProvider('prov-nosheet', ctx.user.id);
    seedBackupConfig({ 'prov-nosheet': { enabled: true, folderPath: 'B', retentionCount: 5 } });
    const res = await postFromProvider(sheetsRestore('prov-nosheet'));
    const body = await json<ErrorBody>(res);
    expect(res.status).toBe(400);
    expect(body.error.message).toBe('No Google Sheets spreadsheet found for this provider');
  });

  test('a user with no backup config at all gets the same spreadsheet error', async () => {
    seedProvider('prov-noconfig', ctx.user.id);
    const res = await postFromProvider(sheetsRestore('prov-noconfig'));
    const body = await json<ErrorBody>(res);
    expect(res.status).toBe(400);
    expect(body.error.message).toBe('No Google Sheets spreadsheet found for this provider');
  });
});
