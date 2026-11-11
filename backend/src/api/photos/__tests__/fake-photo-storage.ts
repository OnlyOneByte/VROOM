/**
 * Routes a test user's photo storage through one in-memory FakeStorageProvider, and makes it the
 * default for every photo category. Only the registry's provider factory is stubbed: ownership,
 * provider status, storage config, and ref resolution all run for real.
 */

import type { TestApp } from '../../../test-helpers/http-client';
import { FakeStorageProvider } from '../../providers/domains/storage/fake-provider';
import { getStorageProviderRegistry } from '../../providers/domains/storage/registry';

export const FAKE_PROVIDER_ID = 'prov-fake-photos';

export interface FakePhotoStorage {
  provider: FakeStorageProvider;
  restore: () => void;
}

export function installFakePhotoStorage(ctx: TestApp): FakePhotoStorage {
  const provider = new FakeStorageProvider();

  ctx.sqlite.run(
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
  ctx.sqlite.run(
    'INSERT OR REPLACE INTO user_preferences (user_id, storage_config) VALUES (?, ?)',
    [ctx.user.id, JSON.stringify({ defaults, providerCategories: {} })]
  );

  const registry = getStorageProviderRegistry();
  registry.createProviderInstance = () => provider;
  return {
    provider,
    restore: () => {
      Reflect.deleteProperty(registry, 'createProviderInstance');
    },
  };
}
