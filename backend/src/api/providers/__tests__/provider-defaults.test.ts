import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  ctx.close();
});

async function createModel(domain: 'llm' | 'vlm', name: string, apiKey: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/providers', {
    domain,
    providerType: 'openai-compatible',
    displayName: name,
    credentials: { apiKey },
    config: { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await json<DataEnvelope<{ id: string }>>(res)).data.id;
}

function recordKeysSent(): string[] {
  const keys: string[] = [];
  globalThis.fetch = (async (_url: string, init?: { headers?: Record<string, string> }) => {
    keys.push(String(init?.headers?.Authorization ?? ''));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Hi' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return keys;
}

const chat = () => ctx.authed('POST', '/api/v1/assistant/chat', { message: 'Hello' });

async function setDefaults(defaults: Record<string, string | null>): Promise<Response> {
  return ctx.authed('PUT', '/api/v1/settings', { providerDefaults: defaults });
}

function storedDefaults(userId = ctx.user.id): Record<string, string | null> {
  const row = ctx.sqlite
    .query('SELECT provider_defaults FROM user_preferences WHERE user_id = ?')
    .get(userId) as { provider_defaults: string | null } | null;
  return JSON.parse(row?.provider_defaults ?? '{}');
}

describe('the assistant uses the default provider the user picked', () => {
  test('with two LLM providers, the chosen default is the one called', async () => {
    const first = await createModel('llm', 'First', 'sk-first');
    const second = await createModel('llm', 'Second', 'sk-second');
    ctx.sqlite.run('UPDATE user_providers SET created_at = 1000 WHERE id = ?', [first]);
    ctx.sqlite.run('UPDATE user_providers SET created_at = 2000 WHERE id = ?', [second]);
    expect((await setDefaults({ 'ai.llm': second })).status).toBe(200);

    const keys = recordKeysSent();
    expect((await chat()).status).toBe(200);
    expect(keys).toEqual(['Bearer sk-second']);
  });

  test('without a default, the oldest provider is used', async () => {
    const second = await createModel('llm', 'Second', 'sk-second');
    const first = await createModel('llm', 'First', 'sk-first');
    ctx.sqlite.run('UPDATE user_providers SET created_at = 1000 WHERE id = ?', [first]);
    ctx.sqlite.run('UPDATE user_providers SET created_at = 2000 WHERE id = ?', [second]);
    const keys = recordKeysSent();
    await chat();
    expect(keys).toEqual(['Bearer sk-first']);
  });

  test('a default that is turned off falls back to another provider', async () => {
    const first = await createModel('llm', 'First', 'sk-first');
    const second = await createModel('llm', 'Second', 'sk-second');
    const third = await createModel('llm', 'Third', 'sk-third');
    ctx.sqlite.run('UPDATE user_providers SET created_at = 1000 WHERE id = ?', [first]);
    ctx.sqlite.run('UPDATE user_providers SET created_at = 2000 WHERE id = ?', [second]);
    ctx.sqlite.run('UPDATE user_providers SET created_at = 3000 WHERE id = ?', [third]);
    await setDefaults({ 'ai.llm': third });
    ctx.sqlite.run("UPDATE user_providers SET status = 'disabled' WHERE id = ?", [third]);
    const keys = recordKeysSent();
    await chat();
    expect(keys).toEqual(['Bearer sk-first']);
  });
});

describe('no provider is a typed error', () => {
  test('the assistant answers NO_PROVIDER for ai.llm', async () => {
    const res = await chat();
    const body = await json<{ error: { code: string; details: { capability: string } } }>(res);
    expect(res.status).toBe(400);
    expect(body.error.code).toBe('NO_PROVIDER');
    expect(body.error.details.capability).toBe('ai.llm');
  });

  test('receipt parsing answers NO_PROVIDER for ai.vision', async () => {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), 'r.jpg');
    const res = await ctx.app.request('/api/v1/receipts/parse', {
      method: 'POST',
      headers: { Cookie: ctx.cookie, 'Sec-Fetch-Site': 'same-origin' },
      body: form,
    });
    const body = await json<{ error: { code: string; details: { capability: string } } }>(res);
    expect(res.status, JSON.stringify(body)).toBe(400);
    expect(body.error.code).toBe('NO_PROVIDER');
    expect(body.error.details.capability).toBe('ai.vision');
  });
});

describe('PUT /settings providerDefaults', () => {
  test('a default is saved, merged with the others, and returned', async () => {
    const llm = await createModel('llm', 'Chat', 'sk-1');
    const vlm = await createModel('vlm', 'Scan', 'sk-2');
    await setDefaults({ 'ai.llm': llm });
    const res = await setDefaults({ 'ai.vision': vlm });
    expect(res.status).toBe(200);
    expect(storedDefaults()).toEqual({ 'ai.llm': llm, 'ai.vision': vlm });
    const settings = await json<DataEnvelope<{ providerDefaults: unknown }>>(
      await ctx.authed('GET', '/api/v1/settings')
    );
    expect(settings.data.providerDefaults).toEqual({ 'ai.llm': llm, 'ai.vision': vlm });
  });

  test('a provider of another capability is refused', async () => {
    const vlm = await createModel('vlm', 'Scan', 'sk-2');
    expect((await setDefaults({ 'ai.llm': vlm })).status).toBe(400);
  });

  test("another user's provider is refused", async () => {
    ctx.sqlite.run(
      "INSERT INTO users (id, email, display_name) VALUES ('other', 'o@example.com', 'Other')"
    );
    ctx.sqlite.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
       VALUES ('theirs', 'other', 'llm', 'openai-compatible', 'Theirs', '', 'active')`
    );
    expect((await setDefaults({ 'ai.llm': 'theirs' })).status).toBe(400);
    expect(storedDefaults()).toEqual({});
  });

  test('null clears a default and leaves the other', async () => {
    const llm = await createModel('llm', 'Chat', 'sk-1');
    const vlm = await createModel('vlm', 'Scan', 'sk-2');
    await setDefaults({ 'ai.llm': llm, 'ai.vision': vlm });
    expect((await setDefaults({ 'ai.llm': null })).status).toBe(200);
    expect(storedDefaults()).toEqual({ 'ai.vision': vlm });
  });

  test('an unknown capability is refused', async () => {
    expect((await setDefaults({ storage: 'x' })).status).toBe(400);
  });
});

describe('deleting the default provider clears the default', () => {
  test('only the deleted provider’s default is cleared', async () => {
    const llm = await createModel('llm', 'Chat', 'sk-1');
    const vlm = await createModel('vlm', 'Scan', 'sk-2');
    await setDefaults({ 'ai.llm': llm, 'ai.vision': vlm });
    expect((await ctx.authed('DELETE', `/api/v1/providers/${llm}`)).status).toBeLessThan(300);
    expect(storedDefaults()['ai.llm'] ?? null).toBeNull();
    expect(storedDefaults()['ai.vision']).toBe(vlm);
  });
});

describe('backup and restore carry the defaults', () => {
  test('a ZIP backup restores the defaults that still point at the user’s providers', async () => {
    const llm = await createModel('llm', 'Chat', 'sk-1');
    await setDefaults({ 'ai.llm': llm });
    const { backupService } = await import('../../sync/backup');
    const { restoreService } = await import('../../sync/restore');
    const zip = await backupService.exportAsZip(ctx.user.id);
    ctx.sqlite.run("UPDATE user_preferences SET provider_defaults = '{}' WHERE user_id = ?", [
      ctx.user.id,
    ]);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(storedDefaults()['ai.llm']).toBe(llm);
  });

  test('a restored default naming a provider the user does not own is dropped', async () => {
    const llm = await createModel('llm', 'Chat', 'sk-1');
    await setDefaults({ 'ai.llm': llm });
    const { backupService } = await import('../../sync/backup');
    const { restoreService } = await import('../../sync/restore');
    const zip = await backupService.exportAsZip(ctx.user.id);
    ctx.sqlite.run('DELETE FROM user_providers WHERE id = ?', [llm]);
    ctx.sqlite.run("UPDATE user_preferences SET provider_defaults = '{}' WHERE user_id = ?", [
      ctx.user.id,
    ]);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(storedDefaults()['ai.llm'] ?? null).toBeNull();
  });

  test('a restored default that names one of the user’s providers of another kind is dropped', async () => {
    const llm = await createModel('llm', 'Chat', 'sk-1');
    const vlm = await createModel('vlm', 'Scan', 'sk-2');
    await setDefaults({ 'ai.llm': llm });
    ctx.sqlite.run('UPDATE user_preferences SET provider_defaults = ? WHERE user_id = ?', [
      JSON.stringify({ 'ai.llm': vlm, 'ai.vision': llm }),
      ctx.user.id,
    ]);
    const { backupService } = await import('../../sync/backup');
    const { restoreService } = await import('../../sync/restore');
    const zip = await backupService.exportAsZip(ctx.user.id);
    ctx.sqlite.run("UPDATE user_preferences SET provider_defaults = '{}' WHERE user_id = ?", [
      ctx.user.id,
    ]);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(storedDefaults()).toEqual({ 'ai.llm': null, 'ai.vision': null });
  });
});
