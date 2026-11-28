import { createHash } from 'node:crypto';
import { logger } from '../../../../utils/logger';
import { assertSafeStoragePath } from '../../../../utils/paths';
import { GoogleDriveService } from '../../services/google-drive-service';
import { coalesceGoogleDriveFile } from './drive-file-utils';
import type {
  StorageFileInfo,
  StorageProvider,
  StorageRef,
  UploadParams,
} from './storage-provider';
import { assertWithinSize, credentialFailureOf, type DownloadOptions } from './storage-provider';

const folderLookups = new Map<string, Promise<string>>();

export class GoogleDriveProvider implements StorageProvider {
  readonly type = 'google-drive';
  private driveService: GoogleDriveService;
  private readonly account: string;

  constructor(refreshToken: string, driveService?: GoogleDriveService) {
    this.driveService = driveService ?? new GoogleDriveService(refreshToken);
    this.account = createHash('sha256').update(refreshToken).digest('hex');
  }

  async upload(params: UploadParams): Promise<StorageRef> {
    assertSafeStoragePath(params.pathHint);
    assertSafeStoragePath(params.rawPath);
    const folderPath = params.rawPath ?? params.pathHint;
    const folderId = await this.resolveFolderPath(folderPath);
    const driveFile = await this.driveService.uploadFile(
      params.fileName,
      params.buffer,
      params.mimeType,
      folderId
    );
    return {
      providerType: this.type,
      externalId: driveFile.id,
      externalUrl: driveFile.webViewLink,
    };
  }

  async download(ref: StorageRef, options?: DownloadOptions): Promise<Buffer> {
    if (options?.maxBytes !== undefined) {
      assertWithinSize(await this.driveService.getFileSize(ref.externalId), options);
    }
    const buffer = await this.driveService.downloadFile(ref.externalId);
    assertWithinSize(buffer.length, options);
    return buffer;
  }

  async delete(ref: StorageRef): Promise<void> {
    await this.driveService.deleteFile(ref.externalId);
  }

  async getExternalUrl(ref: StorageRef): Promise<string | null> {
    return ref.externalUrl ?? null;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.driveService.findFolder('VROOM');
      return true;
    } catch (error) {
      const credentialFailure = credentialFailureOf(error);
      if (credentialFailure) throw credentialFailure;
      logger.warn('Google Drive health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async list(folderPath: string): Promise<StorageFileInfo[]> {
    assertSafeStoragePath(folderPath);
    const folderId = await this.resolveExistingFolderPath(folderPath);
    if (!folderId) return [];

    const files = await this.driveService.listFilesInFolder(folderId);
    return files.map(coalesceGoogleDriveFile);
  }

  private async resolveFolderPath(pathHint: string): Promise<string> {
    const segments = pathHint
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);

    let parentId: string | undefined;

    for (const segment of segments) {
      parentId = await this.findOrCreateFolder(segment, parentId);
    }

    if (!parentId) {
      return '';
    }

    return parentId;
  }

  private findOrCreateFolder(name: string, parentId: string | undefined): Promise<string> {
    const key = `${this.account}/${parentId ?? 'root'}/${name}`;
    const pending = folderLookups.get(key);
    if (pending) return pending;
    const lookup = (async () => {
      const existing = await this.driveService.findFolder(name, parentId);
      return existing ? existing.id : (await this.driveService.createFolder(name, parentId)).id;
    })();
    folderLookups.set(key, lookup);
    const forget = () => folderLookups.delete(key);
    lookup.then(forget, forget);
    return lookup;
  }

  private async resolveExistingFolderPath(pathHint: string): Promise<string | null> {
    const segments = pathHint
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);

    if (segments.length === 0) return null;

    let parentId: string | undefined;

    for (const segment of segments) {
      const existing = await this.driveService.findFolder(segment, parentId);
      if (!existing) return null;
      parentId = existing.id;
    }

    return parentId ?? null;
  }
}
