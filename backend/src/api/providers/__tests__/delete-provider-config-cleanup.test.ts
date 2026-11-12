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

async function createS3Provider(displayName: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/providers', {
    domain: 'storage',
    providerType: 's3',
    displayName,
    credentials: { accessKeyId: 'k', secretAccessKey: 'secret' },
    config: { endpoint: 'https://s3.example.com', bucket: 'b', region: 'us-east-1' },
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.id;
}

function defaults(over: Record<string, string | null> = {}) {
  return {
    vehicle_photos: null,
    expense_receipts: null,
    insurance_docs: null,
    odometer_readings: null,
    ...over,
  };
}

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

describe('DELETE /providers/:id scrubs the provider from storage + backup config', () => {
  test('deleting a storage provider nulls its storageConfig default + removes its categories & backup entry', async () => {
    const id = await createS3Provider('Drive To Delete');

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

    const before = await getSettings();
    expect(before.storageConfig.defaults.vehicle_photos).toBe(id);
    expect(before.storageConfig.providerCategories[id]).toBeDefined();
    expect(before.backupConfig.providers[id]).toBeDefined();

    const del = await ctx.authed('DELETE', `/api/v1/providers/${id}`);
    expect(del.status).toBe(204);

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
    expect(after.storageConfig.defaults.vehicle_photos).toBe(keep);
    expect(after.storageConfig.defaults.expense_receipts).toBeNull();
    expect(after.storageConfig.providerCategories[keep]).toBeDefined();
    expect(after.storageConfig.providerCategories[drop]).toBeUndefined();
  });
});
