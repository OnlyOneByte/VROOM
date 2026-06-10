/**
 * HTTP characterization net for the providers routes (C91 — the safety net half of the
 * C90-filed provider-response-formatter dedup; arch rule 3 needs green→green coverage BEFORE
 * the refactor). providers/routes.ts had ZERO HTTP coverage (a C81-named <50% low spot).
 *
 * This pins the OBSERVABLE CONTRACT the upcoming dedup must preserve — the exact response key
 * shape of the three hand-assembled provider responses (GET list, POST create, PUT update) and
 * the load-bearing security invariant that `credentials` is NEVER echoed back — plus the
 * auth / ownership / domain-guard behavior. When the formatter is extracted next cycle, these
 * assertions stay green unchanged = proof the extraction is behavior-preserving.
 *
 * Runs through the REAL stack (middleware → requireAuth → zValidator → handler → DB) via the
 * in-process harness. We create an `s3` provider rather than `fake`: the POST handler treats any
 * non-google-drive type identically (encrypt(credentials) → insert, no network, no registry
 * instantiation — that only happens on POST /:id/test, which these tests don't call), so s3
 * exercises the same create/list/update/delete + response-shaping path. Critically, s3 needs NO
 * env gate, whereas `fake` is gated on CONFIG.allowFakeStorageProvider — and CONFIG is a
 * process-cached snapshot of process.env built at the FIRST config import, so in the full 148-file
 * suite an earlier file freezes that flag false before this file could set ALLOW_FAKE_STORAGE.
 * Using s3 makes the net independent of cross-file import ordering (green in isolation AND in suite).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

/** The exact key set every hand-assembled provider response emits (the dedup target). */
const PROVIDER_RESPONSE_KEYS = [
  'id',
  'domain',
  'providerType',
  'displayName',
  'status',
  'config',
  'lastSyncAt',
  'createdAt',
].sort();

interface ProviderResponse {
  id: string;
  domain: string;
  providerType: string;
  displayName: string;
  status: string;
  config: Record<string, unknown>;
  lastSyncAt: string | null;
  createdAt: string | null;
}

/** Create an s3 storage provider via the real POST route; returns the parsed data. */
async function createProvider(
  over: Partial<{ domain: string; displayName: string }> = {}
): Promise<ProviderResponse> {
  const res = await ctx.authed('POST', '/api/v1/providers', {
    domain: over.domain ?? 'storage',
    providerType: 's3',
    displayName: over.displayName ?? 'Test S3 Storage',
    credentials: { secretAccessKey: 'super-secret-value', bucket: 'b', region: 'us-east-1' },
    config: { some: 'setting' },
  });
  expect(res.status).toBe(201);
  return (await json<DataEnvelope<ProviderResponse>>(res)).data;
}

describe('POST /api/v1/providers — create', () => {
  test('creates a fake provider (201) with the exact response key shape', async () => {
    const data = await createProvider();
    expect(Object.keys(data).sort()).toEqual(PROVIDER_RESPONSE_KEYS);
    expect(data.id).toBeTruthy();
    expect(data.providerType).toBe('s3');
    expect(data.domain).toBe('storage');
    expect(data.displayName).toBe('Test S3 Storage');
    expect(data.status).toBe('active');
    expect(data.config).toEqual({ some: 'setting' });
  });

  test('NEVER echoes credentials back in the response (security invariant)', async () => {
    const data = await createProvider();
    // The whole point of the hand-assembled formatter is to strip secrets — pin it.
    expect(JSON.stringify(data)).not.toContain('super-secret-value');
    expect('credentials' in data).toBe(false);
  });

  test('rejects an unauthenticated create (401)', async () => {
    const res = await ctx.anon('POST', '/api/v1/providers', {
      domain: 'storage',
      providerType: 's3',
      displayName: 'Unauthed',
      credentials: {},
    });
    expect(res.status).toBe(401);
  });

  test("rejects the reserved 'auth' domain (400)", async () => {
    const res = await ctx.authed('POST', '/api/v1/providers', {
      domain: 'auth',
      providerType: 's3',
      displayName: 'Bad',
      credentials: {},
    });
    expect(res.status).toBe(400);
  });

  test('rejects an invalid providerType (400 via zValidator)', async () => {
    const res = await ctx.authed('POST', '/api/v1/providers', {
      domain: 'storage',
      providerType: 'not-a-provider',
      displayName: 'Bad',
      credentials: {},
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/providers — list', () => {
  test('lists the user providers with the exact response key shape (no credentials)', async () => {
    await createProvider({ displayName: 'P1' });
    const res = await ctx.authed('GET', '/api/v1/providers');
    expect(res.status).toBe(200);
    const body = await json<DataEnvelope<ProviderResponse[]>>(res);
    expect(body.data.length).toBe(1);
    const [row] = body.data;
    expect(Object.keys(row).sort()).toEqual(PROVIDER_RESPONSE_KEYS);
    expect(JSON.stringify(body.data)).not.toContain('super-secret-value');
  });

  test('empty list for a user with no providers (200, [])', async () => {
    const res = await ctx.authed('GET', '/api/v1/providers');
    expect(res.status).toBe(200);
    const body = await json<DataEnvelope<ProviderResponse[]>>(res);
    expect(body.data).toEqual([]);
  });

  test('filters by the ?domain query param', async () => {
    await createProvider({ domain: 'storage', displayName: 'Storage one' });
    const res = await ctx.authed('GET', '/api/v1/providers?domain=nonexistent');
    const body = await json<DataEnvelope<ProviderResponse[]>>(res);
    expect(body.data).toEqual([]);
  });

  test('rejects an unauthenticated list (401)', async () => {
    const res = await ctx.anon('GET', '/api/v1/providers');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/v1/providers/:id — update', () => {
  test('updates displayName + config, returns the exact response key shape (no credentials)', async () => {
    const created = await createProvider({ displayName: 'Before' });
    const res = await ctx.authed('PUT', `/api/v1/providers/${created.id}`, {
      displayName: 'After',
      config: { changed: true },
    });
    expect(res.status).toBe(200);
    const data = (await json<DataEnvelope<ProviderResponse>>(res)).data;
    expect(Object.keys(data).sort()).toEqual(PROVIDER_RESPONSE_KEYS);
    expect(data.displayName).toBe('After');
    expect(data.config).toEqual({ changed: true });
    expect(JSON.stringify(data)).not.toContain('credentials');
  });

  test("404s another user's provider (ownership-scoped, no existence leak)", async () => {
    const created = await createProvider();
    // A second app = a second seeded user with a different session cookie.
    const other = await createTestApp();
    const res = await other.authed('PUT', `/api/v1/providers/${created.id}`, {
      displayName: 'hijack',
    });
    expect(res.status).toBe(404);
    other.close();
  });

  test('404s a non-existent provider id', async () => {
    const res = await ctx.authed('PUT', '/api/v1/providers/nonexistent-id', {
      displayName: 'x',
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/providers/:id', () => {
  test('deletes an owned provider (204) and it disappears from the list', async () => {
    const created = await createProvider();
    const del = await ctx.authed('DELETE', `/api/v1/providers/${created.id}`);
    expect(del.status).toBe(204);
    const list = await json<DataEnvelope<ProviderResponse[]>>(
      await ctx.authed('GET', '/api/v1/providers')
    );
    expect(list.data).toEqual([]);
  });

  test("404s deleting another user's provider", async () => {
    const created = await createProvider();
    const other = await createTestApp();
    const res = await other.authed('DELETE', `/api/v1/providers/${created.id}`);
    expect(res.status).toBe(404);
    other.close();
  });
});
