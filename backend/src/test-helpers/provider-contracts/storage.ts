import { describe, test } from 'bun:test';
import type { StorageProvider } from '../../api/providers/domains/storage/storage-provider';
import { STORAGE_CHECKS } from './storage-checks';

export function describeStorageContract(name: string, make: () => StorageProvider): void {
  describe(`${name} storage contract`, () => {
    for (const item of STORAGE_CHECKS) {
      test(item.name, () => item.run(make));
    }
  });
}
