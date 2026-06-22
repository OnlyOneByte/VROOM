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
    credentials: { accessKeyId: 'AKIA-test', secretAccessKey: 'super-secret-value' },
    // S3 config must carry endpoint/bucket/region (C349: create-time validation rejects an
    // incomplete S3 config rather than persisting a row that throws on first use).
    config: { endpoint: 'https://s3.example.com', bucket: 'b', region: 'us-east-1' },
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
    expect(data.config).toEqual({
      endpoint: 'https://s3.example.com',
      bucket: 'b',
      region: 'us-east-1',
    });
  });

  test('C349: rejects an S3 create whose config is missing endpoint/bucket/region (400, not a broken 201)', async () => {
    // The Zod schema's `config: z.record(...)` is shape-open, so without the create-time guard an S3
    // row with no usable config would persist + auto-populate storageConfig, then throw on EVERY use
    // (test/sync) — a fail-late footgun. Fail-fast at create instead (mirrors buildS3Provider:62).
    const res = await ctx.authed('POST', '/api/v1/providers', {
      domain: 'storage',
      providerType: 's3',
      displayName: 'Incomplete S3',
      credentials: { accessKeyId: 'k', secretAccessKey: 's' },
      config: { bucket: 'b' }, // missing endpoint + region
    });
    expect(res.status).toBe(400);
    // And nothing was persisted: the list stays empty.
    const list = await ctx.authed('GET', '/api/v1/providers');
    expect((await json<DataEnvelope<ProviderResponse[]>>(list)).data).toHaveLength(0);
  });

  test('C349: rejects an S3 create with NO config at all (400)', async () => {
    const res = await ctx.authed('POST', '/api/v1/providers', {
      domain: 'storage',
      providerType: 's3',
      displayName: 'No-config S3',
      credentials: { accessKeyId: 'k', secretAccessKey: 's' },
    });
    expect(res.status).toBe(400);
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
    // A complete S3 config (the default provider is s3): the C416 gate requires endpoint/bucket/region
    // on a config update too, so the happy path must send a full config (not a partial like {changed:true}).
    const newConfig = { endpoint: 'https://s3.example.com', bucket: 'b2', region: 'us-west-2' };
    const res = await ctx.authed('PUT', `/api/v1/providers/${created.id}`, {
      displayName: 'After',
      config: newConfig,
    });
    expect(res.status).toBe(200);
    const data = (await json<DataEnvelope<ProviderResponse>>(res)).data;
    expect(Object.keys(data).sort()).toEqual(PROVIDER_RESPONSE_KEYS);
    expect(data.displayName).toBe('After');
    expect(data.config).toEqual(newConfig);
    expect(JSON.stringify(data)).not.toContain('credentials');
  });

  // #123 (C416, the #103/C349 sibling on the UPDATE path): C349 fail-fasts an incomplete S3 config on
  // CREATE, but PUT wrote body.config verbatim — so editing an S3 provider to a config missing
  // endpoint/bucket/region persisted a 200 + a bricked row that threw on every later test/upload/sync.
  // The fix shares the CREATE gate (validateStorageProviderConfig) on PUT. NON-VACUOUS: pre-fix this was 200.
  test('rejects a PUT that swaps an S3 provider to an INCOMPLETE config (400, the #103/C349 sibling)', async () => {
    const created = await createProvider();
    const res = await ctx.authed('PUT', `/api/v1/providers/${created.id}`, {
      config: { bucket: 'b' }, // missing endpoint + region
    });
    expect(res.status).toBe(400);
    // The original complete config must survive the rejected update (no partial persist).
    const list = (
      await json<DataEnvelope<ProviderResponse[]>>(await ctx.authed('GET', '/api/v1/providers'))
    ).data;
    const after = list.find((p) => p.id === created.id);
    expect(after?.config).toEqual({
      endpoint: 'https://s3.example.com',
      bucket: 'b',
      region: 'us-east-1',
    });
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

  // C260: the credentials-re-encrypt branch (routes.ts:397-399) was uncovered — the security-sensitive
  // one. A PUT carrying new credentials must RE-ENCRYPT them into the column (never store plaintext)
  // and still never echo them in the response.
  test('PUT with new credentials re-encrypts the stored blob (never plaintext, never echoed)', async () => {
    const created = await createProvider();
    const res = await ctx.authed('PUT', `/api/v1/providers/${created.id}`, {
      credentials: { secretAccessKey: 'rotated-secret-9999', bucket: 'b', region: 'us-east-1' },
    });
    expect(res.status).toBe(200);
    const data = (await json<DataEnvelope<ProviderResponse>>(res)).data;
    // Never echoed in the response.
    expect(JSON.stringify(data)).not.toContain('rotated-secret-9999');
    expect('credentials' in data).toBe(false);

    // Stored column was updated and the plaintext secret is NOT in it (encrypted at rest).
    const row = ctx.sqlite
      .query('SELECT credentials FROM user_providers WHERE id = ?')
      .get(created.id) as { credentials: string };
    expect(row.credentials, 'credentials column present').toBeTruthy();
    expect(row.credentials).not.toContain('rotated-secret-9999');
  });

  test('PUT against an AUTH-domain provider → 400 (managed via /auth only)', async () => {
    // Raw-seed an auth-domain provider owned by the user (the create route rejects domain:'auth').
    ctx.sqlite.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
       VALUES ('auth-prov', ?, 'auth', 'google', 'My Login', '', 'active')`,
      [ctx.user.id]
    );
    const res = await ctx.authed('PUT', '/api/v1/providers/auth-prov', { displayName: 'hijack' });
    expect(res.status).toBe(400);
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

/**
 * #63 (C192): the PUT/DELETE destructive writes are scoped on (id AND userId), not id alone. The
 * findOwnedProviderOrThrow guard already 404s a foreign id (the tests above), so this is
 * defense-in-depth — but the write predicate must ALSO be tenant-scoped so a future guard-drop can't
 * become a cross-tenant write (the C109/#52 class, closed at split C155 + odometer C168/C180). Raw-seed
 * a FOREIGN user's provider that COEXISTS in the shared DB (a second createTestApp would reset it) and
 * prove our destructive ops can't touch it.
 */
// C108 (guard): GET /:id/sync-status had ZERO HTTP coverage despite carrying the SAME
// findOwnedProviderOrThrow tenant-isolation chokepoint the PUT/DELETE paths pin — but on a READ path. A
// guard-drop here would leak ANOTHER tenant's per-category photo-sync counts (total/synced/failed) for any
// provider id (NORTH_STAR #2 isolation), invisible to every existing test. This pins: owned → 200 with the
// 4-category {total,synced,failed} shape; foreign id → 404 (no existence leak); anon → 401.
describe('GET /api/v1/providers/:id/sync-status — owned read + tenant isolation', () => {
  const SYNC_CATEGORIES = [
    'vehicle_photos',
    'expense_receipts',
    'insurance_docs',
    'odometer_readings',
  ].sort();

  test('owned provider → 200 with the per-category {total,synced,failed} shape', async () => {
    const created = await createProvider();
    const res = await ctx.authed('GET', `/api/v1/providers/${created.id}/sync-status`);
    expect(res.status).toBe(200);
    const data = (await json<DataEnvelope<Record<string, Record<string, number>>>>(res)).data;
    expect(Object.keys(data).sort()).toEqual(SYNC_CATEGORIES);
    // Each category is the exact counts triad; a fresh provider has nothing synced/failed yet.
    for (const cat of SYNC_CATEGORIES) {
      expect(Object.keys(data[cat]).sort()).toEqual(['failed', 'synced', 'total']);
      expect(data[cat].synced).toBe(0);
      expect(data[cat].failed).toBe(0);
      expect(typeof data[cat].total).toBe('number');
    }
  });

  test("404s another user's provider id (the ownership chokepoint — no sync-status leak)", async () => {
    const created = await createProvider();
    const other = await createTestApp();
    const res = await other.authed('GET', `/api/v1/providers/${created.id}/sync-status`);
    expect(res.status).toBe(404); // findOwnedProviderOrThrow — same guard as PUT/DELETE, now pinned on the read
    other.close();
  });

  test('404s a non-existent provider id', async () => {
    const res = await ctx.authed('GET', '/api/v1/providers/nonexistent-id/sync-status');
    expect(res.status).toBe(404);
  });

  test('rejects an unauthenticated sync-status read (401)', async () => {
    const created = await createProvider();
    const res = await ctx.anon('GET', `/api/v1/providers/${created.id}/sync-status`);
    expect(res.status).toBe(401);
  });
});

describe('#63 — provider PUT/DELETE writes are tenant-scoped (foreign row survives)', () => {
  /** Seed a provider owned by ANOTHER user directly; returns its id. */
  function seedForeignProvider(id: string): void {
    ctx.sqlite.run(
      `INSERT INTO users (id, email, display_name) VALUES ('u-foreign-63', 'f63@test.com', 'Foreign 63')`
    );
    ctx.sqlite.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
       VALUES (?, 'u-foreign-63', 'storage', 's3', 'Foreign Provider', 'enc-blob', 'active')`,
      [id]
    );
  }

  /** True iff a provider row with this id still exists (any owner). */
  function providerExists(id: string): boolean {
    const rows = ctx.sqlite.query('SELECT id FROM user_providers WHERE id = ?').all(id);
    return rows.length === 1;
  }

  test('our DELETE of a foreign provider id 404s AND the foreign row SURVIVES', async () => {
    seedForeignProvider('prov-foreign-del');
    const res = await ctx.authed('DELETE', '/api/v1/providers/prov-foreign-del');
    expect(res.status).toBe(404); // the guard
    expect(providerExists('prov-foreign-del')).toBe(true); // the write predicate — never touched it
  });

  test('our PUT of a foreign provider id 404s AND the foreign row is UNCHANGED', async () => {
    seedForeignProvider('prov-foreign-put');
    const res = await ctx.authed('PUT', '/api/v1/providers/prov-foreign-put', {
      displayName: 'hijacked',
    });
    expect(res.status).toBe(404);
    // The foreign row keeps its original displayName — the update predicate excluded it.
    const row = ctx.sqlite
      .query('SELECT display_name FROM user_providers WHERE id = ?')
      .get('prov-foreign-put') as { display_name: string } | undefined;
    expect(row?.display_name).toBe('Foreign Provider');
  });

  test('our OWN provider still deletes (204) — the tenant scope is not over-broad', async () => {
    const created = await createProvider();
    const del = await ctx.authed('DELETE', `/api/v1/providers/${created.id}`);
    expect(del.status).toBe(204);
    expect(providerExists(created.id)).toBe(false);
  });
});
