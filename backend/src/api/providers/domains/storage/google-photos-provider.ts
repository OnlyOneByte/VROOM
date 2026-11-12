import { logger } from '../../../../utils/logger';
import { GooglePhotosService } from '../../services/google-photos-service';
import type {
  StorageCapabilities,
  StorageFileInfo,
  StorageProvider,
  StorageRef,
  UploadParams,
} from './storage-provider';

export class GooglePhotosProvider implements StorageProvider {
  readonly type = 'google-photos';
  readonly capabilities: StorageCapabilities = {
    delete: false,
    list: false,
    arbitraryFiles: false,
  };

  private service: GooglePhotosService;

  constructor(refreshToken: string, service?: GooglePhotosService, albumId?: string) {
    this.service = service ?? new GooglePhotosService(refreshToken, undefined, albumId);
  }

  async upload(params: UploadParams): Promise<StorageRef> {
    const item = await this.service.uploadImage(params.buffer, params.mimeType, params.fileName);
    return {
      providerType: this.type,
      externalId: item.id,
      externalUrl: item.baseUrl,
    };
  }

  async download(ref: StorageRef): Promise<Buffer> {
    return this.service.download(ref.externalId);
  }

  // Library API cannot delete; the photo stays in the user's Google Photos library.
  async delete(_ref: StorageRef): Promise<void> {
    logger.debug('GooglePhotosProvider.delete is a no-op (Library API is append-only)');
  }

  // Base URLs expire after about 60 minutes, so always fetch a fresh one.
  async getExternalUrl(ref: StorageRef): Promise<string | null> {
    try {
      return await this.service.getFreshUrl(ref.externalId);
    } catch (error) {
      logger.warn('Failed to refresh Google Photos URL', {
        externalId: ref.externalId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    return this.service.healthCheck();
  }

  async list(_folderPath: string): Promise<StorageFileInfo[]> {
    return [];
  }
}
