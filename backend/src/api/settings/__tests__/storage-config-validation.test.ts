/**
 * PUT /settings storageConfig consistency validation (C239 guard). validateStorageConfig
 * (settings/routes.ts) was only ~56% covered — its 4 branches gate a user from saving a broken or
 * cross-tenant storage-routing config, so a regression would let photos route to a non-owned/disabled
 * provider. These drive the REAL validator through the HTTP stack with raw-seeded owned providers (the
 * C237 backup-config-merge pattern); the validator runs on the MERGED storageConfig, so this also
 * exercises mergeStorageConfig.
 *
 * Branches pinned: (1) a referenced provider not owned → 400; (2) a category default whose provider has
 * NO providerCategories entry → 400; (3) a default whose category is present but NOT enabled → 400;
 * (4) a fully-consistent config → 200 (positive control). createTestApp() rewrites env + dynamic-imports
 * DB-bound modules, so imports stay limited to the harness + bun:test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, json, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

/** Raw-seed an owned storage provider so storageConfig references to it pass ownership. */
function seedProvider(id: string): void {
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
     VALUES (?, ?, 'storage', 'google-drive', ?, '', 'active')`,
    [id, ctx.user.id, `Provider ${id}`]
  );
}

interface ErrorBody {
  success: boolean;
  error: { code: string; message: string };
}

function putStorageConfig(storageConfig: unknown) {
  return ctx.authed('PUT', '/api/v1/settings', { storageConfig });
}

/** All-null defaults (the shape DEFAULT_STORAGE_CONFIG uses); override one key per test. */
function defaults(over: Record<string, string | null> = {}) {
  return {
    vehicle_photos: null,
    expense_receipts: null,
    insurance_docs: null,
    odometer_readings: null,
    ...over,
  };
}

/**
 * A complete per-provider category map. The inner `z.record(photoCategoryEnum, …)` is EXHAUSTIVE in
 * Zod v4 (the C70 trap) — every category key must be present — so build all 4, then override.
 */
function categoryMap(over: Record<string, { enabled: boolean; folderPath: string }> = {}) {
  const base = { enabled: true, folderPath: '/Backups' };
  return {
    vehicle_photos: { ...base },
    expense_receipts: { ...base },
    insurance_docs: { ...base },
    odometer_readings: { ...base },
    ...over,
  };
}

describe('PUT /settings storageConfig consistency validation (C239)', () => {
  test('a fully-consistent storageConfig is accepted (positive control)', async () => {
    seedProvider('drive-1');
    const res = await putStorageConfig({
      defaults: defaults({ vehicle_photos: 'drive-1' }),
      providerCategories: { 'drive-1': categoryMap() },
    });
    expect(res.status).toBe(200);
  });

  test('a default referencing a NON-OWNED provider → 400 (ownership + no cross-tenant routing)', async () => {
    // 'ghost' is never seeded — not in this user's providers.
    const res = await putStorageConfig({
      defaults: defaults({ vehicle_photos: 'ghost' }),
      providerCategories: { ghost: categoryMap() },
    });
    expect(res.status).toBe(400);
    const body = (await json<ErrorBody>(res)) as ErrorBody;
    expect(body.error.message).toContain('does not belong to this user');
  });

  test('a default whose provider has NO providerCategories entry → 400', async () => {
    seedProvider('drive-2');
    const res = await putStorageConfig({
      defaults: defaults({ vehicle_photos: 'drive-2' }),
      providerCategories: {}, // drive-2 is owned but has no category settings at all
    });
    expect(res.status).toBe(400);
    const body = (await json<ErrorBody>(res)) as ErrorBody;
    expect(body.error.message).toContain('no category settings');
  });

  test('a default whose category is present but NOT enabled → 400', async () => {
    seedProvider('drive-3');
    const res = await putStorageConfig({
      defaults: defaults({ vehicle_photos: 'drive-3' }),
      providerCategories: {
        // vehicle_photos present but disabled — can't be the default while disabled.
        'drive-3': categoryMap({ vehicle_photos: { enabled: false, folderPath: '/Vehicles' } }),
      },
    });
    expect(res.status).toBe(400);
    const body = (await json<ErrorBody>(res)) as ErrorBody;
    expect(body.error.message).toContain('Cannot disable');
  });
});
