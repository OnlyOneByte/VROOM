/**
 * PUT /settings storageConfig consistency rules, through the HTTP stack. A default must reference an
 * owned provider that has its category enabled, so photos cannot route to a foreign or disabled one.
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

// The per-provider category map is exhaustive in Zod 4, so every category key must be present.
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

describe('PUT /settings storageConfig consistency validation', () => {
  test('a fully-consistent storageConfig is accepted (positive control)', async () => {
    seedProvider('drive-1');
    const res = await putStorageConfig({
      defaults: defaults({ vehicle_photos: 'drive-1' }),
      providerCategories: { 'drive-1': categoryMap() },
    });
    expect(res.status).toBe(200);
  });

  test('a default referencing a non-owned provider → 400', async () => {
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
      providerCategories: {},
    });
    expect(res.status).toBe(400);
    const body = (await json<ErrorBody>(res)) as ErrorBody;
    expect(body.error.message).toContain('no category settings');
  });

  test('a default whose category is present but disabled → 400', async () => {
    seedProvider('drive-3');
    const res = await putStorageConfig({
      defaults: defaults({ vehicle_photos: 'drive-3' }),
      providerCategories: {
        'drive-3': categoryMap({ vehicle_photos: { enabled: false, folderPath: '/Vehicles' } }),
      },
    });
    expect(res.status).toBe(400);
    const body = (await json<ErrorBody>(res)) as ErrorBody;
    expect(body.error.message).toContain('Cannot disable');
  });
});
