/**
 * Google Photos storage provider — wraps GooglePhotosService behind the
 * StorageProvider interface, declaring REDUCED capabilities (see
 * .kiro/specs/google-photos-provider/):
 *   - delete: false      — the Library API is append-only; delete() is a no-op (D1a).
 *   - list: false        — no folder/album listing for backup; list() returns [] (D3b).
 *   - arbitraryFiles: false — photos/videos only; callers must not route PDFs here (D2a).
 *
 * Callers consult `capabilitiesOf(provider)` BEFORE invoking delete/list/upload of a
 * non-image, so these reduced operations degrade predictably rather than throwing.
 */

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

  /**
   * @param refreshToken Google OAuth refresh token (ignored when `service` injected).
   * @param service      Optional pre-built service (inject one wired to the in-memory
   *                     fake Photos client in tests — zero network).
   * @param albumId      Optional cached VROOM album id (from provider `config`).
   */
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

  /**
   * No-op (D1a). Google Photos has no library-delete; the caller (photo-service)
   * still removes the VROOM photo/photo_ref rows, so it disappears from VROOM while
   * remaining in the user's Google Photos library. capabilities.delete=false lets
   * the caller surface that to the user rather than expecting backend removal.
   */
  async delete(_ref: StorageRef): Promise<void> {
    logger.debug('GooglePhotosProvider.delete is a no-op (Library API is append-only)');
  }

  /** Fetch a FRESH baseUrl — the stored one expires (~60 min). */
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

  /** Returns [] (D3b) — Google Photos isn't a backup-ZIP target, only a photo destination. */
  async list(_folderPath: string): Promise<StorageFileInfo[]> {
    return [];
  }
}
