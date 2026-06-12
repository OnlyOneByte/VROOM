/**
 * DELETE /providers/:id storage-config cleanup side effects (C245 guard). Deleting a STORAGE provider
 * must scrub every reference to it from the user's settings — else a dangling storageConfig default
 * leaves photo uploads routing to a provider that no longer exists, and a stale backupConfig entry
 * lingers (the C237 area). The DELETE handler's cleanupStorageConfig + cleanupBackupConfig (routes.ts:
 * 418-454) had no end-to-end coverage — the existing providers-routes-http DELETE tests only assert
 * the 204 + tenant-scoping, not the settings scrub. This drives the REAL POST→PUT-settings→DELETE→GET
 * stack via the s3 seam (no OAuth, no env gate — the C91 rationale).
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules — imports limited to harness + bun:test.
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

/** Create an s3 storage provider via the real POST route; returns its id. */
async function createS3Provider(displayName: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/providers', {
    domain: 'storage',
    providerType: 's3',
    displayName,
    credentials: { secretAccessKey: 'secret', bucket: 'b', region: 'us-east-1' },
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.id;
}

/** All-null storageConfig defaults; override per test. */
function defaults(over: Record<string, string | null> = {}) {
  return {
    vehicle_photos: null,
    expense_receipts: null,
    insurance_docs: null,
    odometer_readings: null,
    ...over,
  };
}

/** Complete per-provider category map (the inner z.record is EXHAUSTIVE in Zod v4 — the C70 trap). */
function categoryMap() {
  const base = { enabled: true, folderPath: '/Backups' };
  return {
    vehicle_photos: { ...base },
    expense_receipts: { ...base },
    insurance_docs: { ...base },
    odometer_readings: { ...base },
  };
}

interface SettingsBody {
  data: {
    storageConfig: {
      defaults: Record<string, string | null>;
      providerCategories: Record<string, unknown>;
    };
    backupConfig: { providers: Record<string, unknown> };
  };
}

async function getSettings(): Promise<SettingsBody['data']> {
  const res = await ctx.authed('GET', '/api/v1/settings');
  expect(res.status).toBe(200);
  return (await json<SettingsBody>(res)).data;
}

describe('DELETE /providers/:id scrubs the provider from storage + backup config (C245)', () => {
  test('deleting a storage provider nulls its storageConfig default + removes its categories & backup entry', async () => {
    const id = await createS3Provider('Drive To Delete');

    // Point a category default at it + give it a providerCategories entry + a backupConfig entry.
    const put = await ctx.authed('PUT', '/api/v1/settings', {
      storageConfig: {
        defaults: defaults({ vehicle_photos: id }),
        providerCategories: { [id]: categoryMap() },
      },
      backupConfig: {
        providers: { [id]: { enabled: true, folderPath: '/Backups', retentionCount: 7 } },
      },
    });
    expect(put.status, await put.text()).toBe(200);

    // Sanity: the references are present before delete.
    const before = await getSettings();
    expect(before.storageConfig.defaults.vehicle_photos).toBe(id);
    expect(before.storageConfig.providerCategories[id]).toBeDefined();
    expect(before.backupConfig.providers[id]).toBeDefined();

    // Delete the provider.
    const del = await ctx.authed('DELETE', `/api/v1/providers/${id}`);
    expect(del.status).toBe(204);

    // Every reference is scrubbed: the default is nulled, the category + backup entries are gone.
    const after = await getSettings();
    expect(after.storageConfig.defaults.vehicle_photos, 'default nulled').toBeNull();
    expect(after.storageConfig.providerCategories[id], 'category entry removed').toBeUndefined();
    expect(after.backupConfig.providers[id], 'backup entry removed').toBeUndefined();
  });

  test('deleting a storage provider leaves OTHER providers’ config references intact', async () => {
    const keep = await createS3Provider('Keep');
    const drop = await createS3Provider('Drop');

    await ctx.authed('PUT', '/api/v1/settings', {
      storageConfig: {
        defaults: defaults({ vehicle_photos: keep, expense_receipts: drop }),
        providerCategories: { [keep]: categoryMap(), [drop]: categoryMap() },
      },
    });

    const del = await ctx.authed('DELETE', `/api/v1/providers/${drop}`);
    expect(del.status).toBe(204);

    const after = await getSettings();
    // 'keep' is untouched; only 'drop' is scrubbed.
    expect(after.storageConfig.defaults.vehicle_photos).toBe(keep);
    expect(after.storageConfig.defaults.expense_receipts).toBeNull();
    expect(after.storageConfig.providerCategories[keep]).toBeDefined();
    expect(after.storageConfig.providerCategories[drop]).toBeUndefined();
  });
});
