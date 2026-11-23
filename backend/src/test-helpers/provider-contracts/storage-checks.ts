import {
  capabilitiesOf,
  type StorageProvider,
  type UploadParams,
} from '../../api/providers/domains/storage/storage-provider';

export interface StorageCheck {
  name: string;
  run: (make: () => StorageProvider) => Promise<void>;
}

function upload(provider: StorageProvider, over: Partial<UploadParams> = {}) {
  return provider.upload({
    fileName: 'receipt.jpg',
    buffer: Buffer.from('contract bytes'),
    mimeType: 'image/jpeg',
    entityType: 'expense',
    entityId: 'e-contract',
    pathHint: 'contract',
    ...over,
  });
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function rejects(work: () => Promise<unknown>, message: string): Promise<void> {
  let refused = false;
  try {
    await work();
  } catch {
    refused = true;
  }
  check(refused, message);
}

export const STORAGE_CHECKS: StorageCheck[] = [
  {
    name: 'upload and download round-trip',
    run: async (make) => {
      const provider = make();
      const ref = await upload(provider);
      const bytes = await provider.download(ref);
      check(bytes.toString() === 'contract bytes', `downloaded "${bytes.toString()}"`);
    },
  },
  {
    name: 'same-name uploads get unique keys',
    run: async (make) => {
      const provider = make();
      const first = await upload(provider);
      const second = await upload(provider);
      check(first.externalId !== second.externalId, `both uploads got ${first.externalId}`);
    },
  },
  {
    name: 'delete is idempotent, or the provider says it cannot delete',
    run: async (make) => {
      const provider = make();
      const ref = await upload(provider);
      await provider.delete(ref);
      await provider.delete(ref);
      if (capabilitiesOf(provider).delete) {
        await rejects(() => provider.download(ref), 'a deleted file still downloads');
      }
    },
  },
  {
    name: 'list stays within the folder it is given',
    run: async (make) => {
      const provider = make();
      if (!capabilitiesOf(provider).list) return;
      await upload(provider, { rawPath: 'contract/inside', fileName: 'inside.zip' });
      await upload(provider, { rawPath: 'contract/inside-sibling', fileName: 'outside.zip' });
      const names = (await provider.list('contract/inside')).map((file) => file.name);
      check(names.includes('inside.zip'), `list missed its own file: ${names.join(', ')}`);
      check(!names.includes('outside.zip'), `list left its folder: ${names.join(', ')}`);
    },
  },
  {
    name: 'healthCheck answers with a boolean',
    run: async (make) => {
      const healthy = await make().healthCheck();
      check(typeof healthy === 'boolean', `healthCheck returned ${typeof healthy}`);
    },
  },
  {
    name: 'a path with a parent-directory segment is refused',
    run: async (make) => {
      const provider = make();
      await rejects(() => upload(provider, { pathHint: 'contract/../escape' }), 'pathHint');
      await rejects(() => upload(provider, { rawPath: '../escape' }), 'rawPath');
      if (capabilitiesOf(provider).list) {
        await rejects(() => provider.list('contract/../escape'), 'list');
      }
      const longPath = `${'a'.repeat(150)}/${'b'.repeat(150)}`;
      await upload(provider, { rawPath: longPath, fileName: 'long.zip' });
    },
  },
];
