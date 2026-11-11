/** pathHint is walked segment by segment, creating missing folders; the file lands in the leaf. */

import { logger } from '../../../../utils/logger';
import { GoogleDriveService } from '../../services/google-drive-service';
import { coalesceGoogleDriveFile } from './drive-file-utils';
import type {
  StorageFileInfo,
  StorageProvider,
  StorageRef,
  UploadParams,
} from './storage-provider';

export class GoogleDriveProvider implements StorageProvider {
  readonly type = 'google-drive';
  private driveService: GoogleDriveService;

  constructor(refreshToken: string, driveService?: GoogleDriveService) {
    this.driveService = driveService ?? new GoogleDriveService(refreshToken);
  }

  async upload(params: UploadParams): Promise<StorageRef> {
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
      await this.driveService.findFolder('VROOM');
      return true;
    } catch (error) {
      logger.warn('Google Drive health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async list(folderPath: string): Promise<StorageFileInfo[]> {
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
      const existing = await this.driveService.findFolder(segment, parentId);
      if (existing) {
        parentId = existing.id;
      } else {
        const created = await this.driveService.createFolder(segment, parentId);
        parentId = created.id;
      }
    }

    if (!parentId) {
      return '';
    }

    return parentId;
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
