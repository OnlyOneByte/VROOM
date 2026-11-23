import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '../../../../utils/logger';
import { fetchOutbound } from '../../../../utils/outbound-url';
import { assertSafeStoragePath } from '../../../../utils/paths';
import type {
  StorageFileInfo,
  StorageProvider,
  StorageRef,
  UploadParams,
} from './storage-provider';

interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
}

const PRESIGNED_URL_EXPIRY_SECONDS = 3600;

function toFileInfo(key: string, size?: number, lastModified?: Date): StorageFileInfo {
  const timestamp = lastModified?.toISOString() ?? new Date(0).toISOString();
  return {
    key,
    name: key.split('/').pop() ?? key,
    size: size ?? 0,
    createdTime: timestamp,
    lastModified: timestamp,
  };
}

interface S3WireRequest {
  protocol: string;
  hostname: string;
  port?: number;
  path: string;
  query?: Record<string, string | string[] | null>;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function encodeQueryPart(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function buildQuery(query: S3WireRequest['query']): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query ?? {})) {
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      parts.push(
        v === null ? encodeQueryPart(key) : `${encodeQueryPart(key)}=${encodeQueryPart(v)}`
      );
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

async function requestBody(body: unknown): Promise<RequestInit['body'] | undefined> {
  if (body === undefined || body === null) return undefined;
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  return body as RequestInit['body'];
}

export const s3RequestHandler = {
  async handle(request: S3WireRequest, options?: { abortSignal?: unknown }) {
    const port = request.port ? `:${request.port}` : '';
    const url = `${request.protocol}//${request.hostname}${port}${request.path}${buildQuery(request.query)}`;
    const res = await fetchOutbound(
      url,
      {
        method: request.method,
        headers: request.headers,
        signal: options?.abortSignal as AbortSignal | undefined,
        body: await requestBody(request.body),
      },
      'S3 endpoint'
    );
    return {
      response: {
        statusCode: res.status,
        reason: res.statusText,
        headers: Object.fromEntries(res.headers),
        body: res.body
          ? Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
          : Readable.from([]),
      },
    };
  },
} as unknown as S3ClientConfig['requestHandler'];

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
      requestHandler: s3RequestHandler,
    });
  }

  async upload(params: UploadParams): Promise<StorageRef> {
    assertSafeStoragePath(params.pathHint);
    assertSafeStoragePath(params.rawPath);
    const key = params.rawPath
      ? this.buildRawKey(params.rawPath, params.fileName)
      : this.buildKey(params.pathHint, params.entityType, params.entityId, params.fileName);

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

  async list(folderPath: string): Promise<StorageFileInfo[]> {
    assertSafeStoragePath(folderPath);
    const folder = folderPath.replace(/^\/+|\/+$/g, '');
    const prefix = folder ? `${folder}/` : '';
    const results: StorageFileInfo[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          Delimiter: '/',
          ContinuationToken: continuationToken,
        })
      );

      for (const obj of response.Contents ?? []) {
        if (obj.Key) results.push(toFileInfo(obj.Key, obj.Size, obj.LastModified));
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return results;
  }

  private buildKey(
    pathHint: string,
    entityType: string,
    entityId: string,
    fileName: string
  ): string {
    const segments = [pathHint, entityType, entityId, `${randomUUID()}-${fileName}`]
      .join('/')
      .split('/')
      .filter(Boolean);

    return segments.join('/');
  }

  private buildRawKey(rawPath: string, fileName: string): string {
    const cleanPath = rawPath.replace(/^\/+/, '').replace(/\/+$/, '');
    return cleanPath ? `${cleanPath}/${fileName}` : fileName;
  }
}
