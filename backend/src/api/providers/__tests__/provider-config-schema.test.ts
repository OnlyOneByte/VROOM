import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { CONFIG } from '../../../config';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import type { ParsedBackupData } from '../../../types';
import { storePending } from '../../../utils/pending-credentials';
import { backupService } from '../../sync/backup';
import { type AnyProviderDescriptor, validateProviderConfig } from '../descriptor';
import { LLM_PROVIDERS } from '../domains/llm/registry';
import { STORAGE_PROVIDERS } from '../domains/storage/registry';
import { VISION_PROVIDERS } from '../domains/vlm/registry';

const REGISTRIES: Record<string, Record<string, AnyProviderDescriptor>> = {
  storage: STORAGE_PROVIDERS,
  llm: LLM_PROVIDERS,
  vlm: VISION_PROVIDERS,
};

const DESCRIPTORS = Object.entries(REGISTRIES).flatMap(([domain, table]) =>
  Object.entries(table).map(([type, descriptor]) => ({ name: `${domain}/${type}`, descriptor }))
);

function validConfig(descriptor: AnyProviderDescriptor): Record<string, unknown> {
  return Object.fromEntries(
    descriptor.config.fields.map((field) => [
      field.key,
      field.default ?? (field.kind === 'url' ? 'https://files.example.com' : 'value'),
    ])
  );
}

describe('every provider config schema is strict', () => {
  for (const { name, descriptor } of DESCRIPTORS) {
    test(`${name} accepts its own fields and refuses an unknown or wrongly typed key`, () => {
      const config = validConfig(descriptor);
      expect(() => validateProviderConfig(descriptor, config)).not.toThrow();
      expect(() => validateProviderConfig(descriptor, { ...config, surprise: 'x' })).toThrow(
        'Unrecognized key'
      );
      const typedKey = descriptor.config.fields[0]?.key ?? 'providerRootPath';
      expect(() => validateProviderConfig(descriptor, { ...config, [typedKey]: 42 })).toThrow();
    });
  }
});

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

const S3 = {
  domain: 'storage',
  providerType: 's3',
  displayName: 'S3',
  credentials: { accessKeyId: 'AKIA', secretAccessKey: 'secret' },
  config: { endpoint: 'https://s3.example.com', bucket: 'b', region: 'us-east-1' },
};

describe('the routes refuse a config the descriptor does not accept', () => {
  test('an unknown key on create is a 400 for storage and model providers', async () => {
    const s3 = await ctx.authed('POST', '/api/v1/providers', {
      ...S3,
      config: { ...S3.config, extra: true },
    });
    expect(s3.status).toBe(400);

    const llm = await ctx.authed('POST', '/api/v1/providers', {
      domain: 'llm',
      providerType: 'anthropic',
      displayName: 'Claude',
      credentials: { apiKey: 'sk-test' },
      config: { model: 'claude', temperature: 2 },
    });
    expect(llm.status).toBe(400);
    expect(await llm.text()).toContain('Unrecognized key');
  });

  test('a server-only key sent on create is dropped, and the server writes its own value', async () => {
    const nonce = crypto.randomUUID();
    storePending(ctx.user.id, nonce, 'refresh-token', 'owner@example.com');
    const res = await ctx.authed('POST', '/api/v1/providers', {
      domain: 'storage',
      providerType: 'google-drive',
      displayName: 'Drive',
      credentials: {},
      config: { photoRootPath: 'Photos', accountEmail: 'someone-else@example.com' },
      nonce,
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { config: Record<string, unknown> } };
    expect(data.config).toEqual({ photoRootPath: 'Photos', accountEmail: 'owner@example.com' });
  });
});

describe('a stored key the schema no longer knows', () => {
  test('is kept when a form echoes it back, but a new unknown key is still refused', async () => {
    const created = await ctx.authed('POST', '/api/v1/providers', S3);
    const { data } = (await created.json()) as { data: { id: string } };
    ctx.sqlite.run('UPDATE user_providers SET config = ? WHERE id = ?', [
      JSON.stringify({ ...S3.config, legacyFolderId: 'f-1' }),
      data.id,
    ]);

    const echoed = await ctx.authed('PUT', `/api/v1/providers/${data.id}`, {
      config: { ...S3.config, legacyFolderId: 'f-1', photoRootPath: 'Scans' },
    });
    expect(echoed.status).toBe(200);

    const added = await ctx.authed('PUT', `/api/v1/providers/${data.id}`, {
      config: { ...S3.config, another: 'x' },
    });
    expect(added.status).toBe(400);
  });
});

describe('one path rule for every storage path setting', () => {
  for (const key of ['providerRootPath', 'photoRootPath']) {
    test(`${key} with a parent-directory segment is refused`, async () => {
      const res = await ctx.authed('POST', '/api/v1/providers', {
        ...S3,
        config: { ...S3.config, [key]: 'vroom/../other' },
      });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('Path traversal not allowed');
    });
  }

  test('a category folderPath with a parent-directory segment is refused', async () => {
    const res = await ctx.authed('PUT', '/api/v1/settings', {
      storageConfig: {
        defaults: {},
        providerCategories: {
          p1: {
            vehicle_photos: { enabled: true, folderPath: '../vehicles' },
            expense_receipts: { enabled: true, folderPath: 'receipts' },
            insurance_docs: { enabled: true, folderPath: 'insurance' },
            odometer_readings: { enabled: true, folderPath: 'odometer' },
          },
        },
      },
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Path traversal not allowed');
  });

  test('a backup whose storage folder path breaks the rule is refused at restore', () => {
    const backup = {
      metadata: {
        version: CONFIG.backup.currentVersion,
        timestamp: new Date().toISOString(),
        userId: 'u1',
      },
      vehicles: [],
      expenses: [],
      financing: [],
      insurance: [],
      insuranceTerms: [],
      insuranceTermVehicles: [],
      userPreferences: [
        {
          userId: 'u1',
          storageConfig: {
            defaults: {},
            providerCategories: { p1: { vehicle_photos: { enabled: true, folderPath: '../x' } } },
          },
        },
      ],
      syncState: [],
      photos: [],
      odometer: [],
      photoRefs: [],
    } as unknown as ParsedBackupData;

    const result = backupService.validateBackupData(backup);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain(
      'storageConfig vehicle_photos folder path is invalid — Path traversal not allowed'
    );
  });
});
