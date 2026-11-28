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
import { ValidationError } from '../../../../errors';
import { logger } from '../../../../utils/logger';
import { fetchOutbound, type PrivateEndpointPolicy } from '../../../../utils/outbound-url';
import { assertSafeStoragePath } from '../../../../utils/paths';
import { OPERATION_TIMEOUTS } from '../../../../utils/timeout';
import type {
  StorageFileInfo,
  StorageProvider,
  StorageRef,
  UploadParams,
} from './storage-provider';
import { credentialFailureOf, ProviderConfigError } from './storage-provider';

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
const REGION_PATTERN = /^[a-z0-9-]{1,32}$/;

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

const SLOWEST_UPLOAD_BYTES_PER_MS = 100;

export function s3RequestTimeoutMs(bodyBytes: number): number {
  return Math.max(OPERATION_TIMEOUTS.DOWNLOAD, 60_000 + bodyBytes / SLOWEST_UPLOAD_BYTES_PER_MS);
}

function bodyLength(body: RequestInit['body'] | undefined): number {
  if (body instanceof Uint8Array) return body.byteLength;
  return typeof body === 'string' ? Buffer.byteLength(body) : 0;
}

function withRequestTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function s3RequestHandlerFor(policy: PrivateEndpointPolicy) {
  return {
    async handle(request: S3WireRequest, options?: { abortSignal?: unknown }) {
      const port = request.port ? `:${request.port}` : '';
      const url = `${request.protocol}//${request.hostname}${port}${request.path}${buildQuery(request.query)}`;
      const body = await requestBody(request.body);
      const res = await fetchOutbound(
        url,
        {
          method: request.method,
          headers: request.headers,
          signal: withRequestTimeout(
            options?.abortSignal as AbortSignal | undefined,
            s3RequestTimeoutMs(bodyLength(body))
          ),
          body,
        },
        'S3 endpoint',
        policy
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
}

export class S3CompatProvider implements StorageProvider {
  readonly type = 's3';
  private client: S3Client;
  private bucket: string;

  constructor(credentials: S3Credentials, config: S3Config, outbound: PrivateEndpointPolicy) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
      },
      forcePathStyle: true,
      requestHandler: s3RequestHandlerFor(outbound),
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
      if (error instanceof ValidationError) throw error;
      const credentialFailure = credentialFailureOf(error);
      if (credentialFailure) throw credentialFailure;
      const configProblem = this.bucketProblemOf(error);
      if (configProblem) throw new ProviderConfigError(configProblem);
      logger.warn('S3 health check failed', {
        bucket: this.bucket,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private bucketProblemOf(error: unknown): string | null {
    const shaped = error as {
      $metadata?: { httpStatusCode?: number };
      $response?: { headers?: Record<string, string | undefined> };
    };
    const status = shaped?.$metadata?.httpStatusCode;
    if (status === 404) {
      return `The bucket "${this.bucket}" doesn't exist. Check the bucket name, then test again.`;
    }
    if (status !== 301) return null;
    const header = shaped.$response?.headers?.['x-amz-bucket-region'];
    const region = header && REGION_PATTERN.test(header) ? header : undefined;
    return region
      ? `The bucket "${this.bucket}" is in region ${region}. Set the region to ${region}, then test again.`
      : `The bucket "${this.bucket}" is in a different region. Check the region, then test again.`;
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
