/**
 * S3-compatible storage provider — covers AWS S3, Backblaze B2, Cloudflare R2, MinIO.
 *
 * Uses the AWS SDK v3 with a custom endpoint to support any S3-compatible service.
 * Key structure: {pathHint}/{entityType}/{entityId}/{fileName}
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '../../utils/logger';
import type { StorageProvider, StorageRef, UploadParams } from './storage-provider';

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
}

/** Default presigned URL expiry: 1 hour */
const PRESIGNED_URL_EXPIRY_SECONDS = 3600;

export class S3CompatProvider implements StorageProvider {
  readonly type = 's3';
  private client: S3Client;
  private bucket: string;

  constructor(credentials: S3Credentials, config: S3Config) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
      },
      forcePathStyle: true,
    });
  }

  async upload(params: UploadParams): Promise<StorageRef> {
    const key = this.buildKey(params.pathHint, params.entityType, params.entityId, params.fileName);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: params.buffer,
        ContentType: params.mimeType,
      })
    );

    return {
      providerType: this.type,
      externalId: key,
    };
  }

  async download(ref: StorageRef): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: ref.externalId,
      })
    );

    if (!response.Body) {
      throw new Error(`Empty response body for key: ${ref.externalId}`);
    }

    return Buffer.from(await response.Body.transformToByteArray());
  }

  async delete(ref: StorageRef): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: ref.externalId,
      })
    );
  }

  async getExternalUrl(ref: StorageRef): Promise<string | null> {
    try {
      const url = await getSignedUrl(
        this.client,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: ref.externalId,
        }),
        { expiresIn: PRESIGNED_URL_EXPIRY_SECONDS }
      );
      return url;
    } catch (error) {
      logger.warn('Failed to generate presigned URL', {
        key: ref.externalId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch (error) {
      logger.warn('S3 health check failed', {
        bucket: this.bucket,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Build the S3 object key from path segments.
   * Strips leading slashes to avoid empty key segments.
   */
  private buildKey(
    pathHint: string,
    entityType: string,
    entityId: string,
    fileName: string
  ): string {
    const segments = [pathHint, entityType, entityId, fileName]
      .join('/')
      .split('/')
      .filter(Boolean);

    return segments.join('/');
  }
}
