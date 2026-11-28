import type { TestApp } from '../../../test-helpers/http-client';
import { FakeStorageProvider } from '../../providers/domains/storage/fake-provider';
import { getStorageProviderRegistry } from '../../providers/domains/storage/registry';

export const FAKE_PROVIDER_ID = 'prov-fake-photos';

export interface FakePhotoStorage {
  provider: FakeStorageProvider;
  restore: () => void;
}

export async function installFakePhotoStorage(ctx: TestApp): Promise<FakePhotoStorage> {
  const provider = new FakeStorageProvider();

  await ctx.sql.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
     VALUES (?, ?, 'storage', 'fake', 'Fake storage', 'unused', 'active')`,
    [FAKE_PROVIDER_ID, ctx.user.id]
  );
  const defaults = {
    vehicle_photos: FAKE_PROVIDER_ID,
    expense_receipts: FAKE_PROVIDER_ID,
    insurance_docs: FAKE_PROVIDER_ID,
    odometer_readings: FAKE_PROVIDER_ID,
  };
  await ctx.sql.run(
    'INSERT INTO user_preferences (user_id, storage_config) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET storage_config = excluded.storage_config',
    [ctx.user.id, JSON.stringify({ defaults, providerCategories: {} })]
  );

  const registry = getStorageProviderRegistry();
  registry.createProviderInstance = async () => provider;
  return {
    provider,
    restore: () => {
      Reflect.deleteProperty(registry, 'createProviderInstance');
    },
  };
}
