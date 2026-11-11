/**
 * In-memory StorageProvider for tests and local E2E. Only instantiated when
 * CONFIG.allowFakeStorageProvider is set, which is never true in production.
 */

import type {
  StorageFileInfo,
  StorageProvider,
  StorageRef,
  UploadParams,
} from './storage-provider';

interface StoredFile {
  key: string;
  name: string;
  buffer: Buffer;
  mimeType: string;
  createdTime: string;
  lastModified: string;
}

export class FakeStorageProvider implements StorageProvider {
  readonly type = 'fake';

  private files = new Map<string, StoredFile>();

  constructor(seed?: StorageFileInfo[]) {
    if (seed) {
      for (const f of seed) {
        this.files.set(f.key, {
          key: f.key,
          name: f.name,
          buffer: Buffer.from(''),
          mimeType: 'application/octet-stream',
          createdTime: f.createdTime,
          lastModified: f.lastModified,
        });
      }
    }
  }

  upload(params: UploadParams): Promise<StorageRef> {
    const key = params.rawPath
      ? `${params.rawPath}/${params.fileName}`
      : `${params.pathHint}/${params.entityType}/${params.entityId}/${params.fileName}`;
    const now = new Date(0).toISOString(); // fixed epoch — deterministic for snapshots
    this.files.set(key, {
      key,
      name: params.fileName,
      buffer: params.buffer,
      mimeType: params.mimeType,
      createdTime: now,
      lastModified: now,
    });
    return Promise.resolve({
      providerType: this.type,
      externalId: key,
      externalUrl: `fake://${key}`,
    });
  }

  download(ref: StorageRef): Promise<Buffer> {
    const file = this.files.get(ref.externalId);
    if (!file) return Promise.reject(new Error(`fake-storage: no file at ${ref.externalId}`));
    return Promise.resolve(file.buffer);
  }

  delete(ref: StorageRef): Promise<void> {
    this.files.delete(ref.externalId);
    return Promise.resolve();
  }

  getExternalUrl(ref: StorageRef): Promise<string | null> {
    return Promise.resolve(this.files.has(ref.externalId) ? `fake://${ref.externalId}` : null);
  }

  healthCheck(): Promise<boolean> {
    return Promise.resolve(true);
  }

  list(folderPath: string): Promise<StorageFileInfo[]> {
    const prefix = folderPath ? `${folderPath}/` : '';
    const out: StorageFileInfo[] = [];
    for (const f of this.files.values()) {
      if (!prefix || f.key.startsWith(prefix)) {
        out.push({
          key: f.key,
          name: f.name,
          size: f.buffer.length,
          createdTime: f.createdTime,
          lastModified: f.lastModified,
        });
      }
    }
    return Promise.resolve(out);
  }
}
