/**
 * Google Drive storage provider — wraps GoogleDriveService behind the StorageProvider interface.
 *
 * Folder resolution uses `pathHint` (e.g. "/VROOM/Vehicle Photos") to find-or-create
 * each segment in the Drive folder hierarchy, then uploads the file into the leaf folder.
 */

import { logger } from '../../utils/logger';
import { GoogleDriveService } from '../sync/google-drive';
import type { StorageProvider, StorageRef, UploadParams } from './storage-provider';

export class GoogleDriveProvider implements StorageProvider {
  readonly type = 'google-drive';
  private driveService: GoogleDriveService;

  constructor(refreshToken: string) {
    this.driveService = new GoogleDriveService(refreshToken);
  }

  async upload(params: UploadParams): Promise<StorageRef> {
    const folderId = await this.resolveFolderPath(params.pathHint);
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

  async download(ref: StorageRef): Promise<Buffer> {
    return this.driveService.downloadFile(ref.externalId);
  }

  async delete(ref: StorageRef): Promise<void> {
    await this.driveService.deleteFile(ref.externalId);
  }

  async getExternalUrl(ref: StorageRef): Promise<string | null> {
    return ref.externalUrl ?? null;
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Lightweight call — just searches for a folder, doesn't create anything
      await this.driveService.findFolder('VROOM');
      return true;
    } catch (error) {
      logger.warn('Google Drive health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Resolves a path like "/VROOM/Vehicle Photos" into a Drive folder ID
   * by walking each segment and finding-or-creating folders along the way.
   */
  private async resolveFolderPath(pathHint: string): Promise<string> {
    const segments = pathHint
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);

    let parentId: string | undefined;

    for (const segment of segments) {
      const existing = await this.driveService.findFolder(segment, parentId);
      if (existing) {
        parentId = existing.id;
      } else {
        const created = await this.driveService.createFolder(segment, parentId);
        parentId = created.id;
      }
    }

    if (!parentId) {
      // pathHint was empty or all-slashes — upload to Drive root
      return '';
    }

    return parentId;
  }
}
