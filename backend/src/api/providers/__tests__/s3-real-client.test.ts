import { afterEach, describe, expect, test } from 'bun:test';
import { PayloadTooLargeError } from '../../../errors';
import { ALLOW_PRIVATE, outboundResolver, urlForAddress } from '../../../utils/outbound-url';
import { S3CompatProvider } from '../domains/storage/s3-compat-provider';

interface SeenRequest {
  method: string;
  path: string;
  host: string | null;
  signed: boolean;
  bodyLength: number;
}

const { lookup, connectUrl } = outboundResolver;
afterEach(() => {
  outboundResolver.lookup = lookup;
  outboundResolver.connectUrl = connectUrl;
});

function fakeS3() {
  const objects = new Map<string, Uint8Array>();
  const seen: SeenRequest[] = [];
  const listXml = (prefix: string) => {
    const contents = [...objects.entries()]
      .filter(([key]) => key.startsWith(`photos/${prefix}`))
      .map(
        ([key, body]) =>
          `<Contents><Key>${key.slice('photos/'.length)}</Key><Size>${body.length}</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>`
      )
      .join('');
    return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>photos</Name><Prefix>${prefix}</Prefix><KeyCount>${objects.size}</KeyCount><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
  };
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = new Uint8Array(await req.arrayBuffer());
      seen.push({
        method: req.method,
        path: url.pathname,
        host: req.headers.get('host'),
        signed: (req.headers.get('authorization') ?? '').startsWith('AWS4-HMAC-SHA256'),
        bodyLength: body.length,
      });
      const key = decodeURIComponent(url.pathname.slice(1));
      if (req.method === 'HEAD') return new Response(null, { status: 200 });
      if (req.method === 'PUT') {
        objects.set(key, body);
        return new Response(null, { status: 200, headers: { etag: '"abc"' } });
      }
      if (req.method === 'DELETE') {
        objects.delete(key);
        return new Response(null, { status: 204 });
      }
      if (url.searchParams.get('list-type') === '2') {
        return new Response(listXml(url.searchParams.get('prefix') ?? ''), {
          headers: { 'content-type': 'application/xml' },
        });
      }
      if (key.endsWith('/unsized.bin')) {
        let sent = 0;
        const chunked = new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (sent >= 64) return controller.close();
            await Bun.sleep(5);
            sent += 16;
            controller.enqueue(new Uint8Array(16));
          },
        });
        return new Response(chunked);
      }
      const stored = objects.get(key);
      if (!stored) return new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
      return new Response(stored, { headers: { 'content-length': String(stored.length) } });
    },
  });
  return { server, seen };
}

describe('the real S3 client through the outbound request handler', () => {
  test('signs, pins and round-trips every call', async () => {
    const { server, seen } = fakeS3();
    try {
      outboundResolver.lookup = async () => ['127.0.0.2', '127.0.0.1'];
      outboundResolver.connectUrl = urlForAddress;
      const provider = new S3CompatProvider(
        { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
        { endpoint: `http://s3.test:${server.port}`, bucket: 'photos', region: 'us-east-1' },
        ALLOW_PRIVATE
      );

      expect(await provider.healthCheck()).toBe(true);
      const ref = await provider.upload({
        buffer: Buffer.from('real s3 client bytes'),
        fileName: 'receipt.jpg',
        mimeType: 'image/jpeg',
        entityType: 'expense',
        entityId: 'e1',
        pathHint: '',
        rawPath: 'receipts',
      });
      expect(ref.externalId).toBe('receipts/receipt.jpg');
      expect((await provider.download(ref)).toString()).toBe('real s3 client bytes');
      expect((await provider.list('receipts')).map((f) => f.key)).toEqual(['receipts/receipt.jpg']);
      await provider.delete(ref);

      expect(seen.map((r) => `${r.method} ${r.path}`)).toEqual([
        'HEAD /photos/',
        'PUT /photos/receipts/receipt.jpg',
        'GET /photos/receipts/receipt.jpg',
        'GET /photos/',
        'DELETE /photos/receipts/receipt.jpg',
      ]);
      expect(seen.every((r) => r.signed && r.host?.startsWith('s3.test:'))).toBe(true);
      expect(seen[1]?.bodyLength).toBe('real s3 client bytes'.length);
    } finally {
      server.stop(true);
    }
  });

  test('a capped download is refused over the limit and returned whole within it', async () => {
    const { server } = fakeS3();
    try {
      outboundResolver.lookup = async () => ['127.0.0.1'];
      outboundResolver.connectUrl = urlForAddress;
      const provider = new S3CompatProvider(
        { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
        { endpoint: `http://s3.test:${server.port}`, bucket: 'photos', region: 'us-east-1' },
        ALLOW_PRIVATE
      );
      const ref = await provider.upload({
        buffer: Buffer.alloc(64),
        fileName: 'vroom-backup-1.zip',
        mimeType: 'application/zip',
        entityType: 'backup',
        entityId: 'u1',
        pathHint: '',
        rawPath: 'Backups',
      });

      expect((await provider.download(ref, { maxBytes: 64 })).length).toBe(64);
      await expect(provider.download(ref, { maxBytes: 32 })).rejects.toBeInstanceOf(
        PayloadTooLargeError
      );

      const direct = await fetch(`http://127.0.0.1:${server.port}/photos/Backups/unsized.bin`);
      expect(direct.headers.get('content-length')).toBeNull();
      await direct.arrayBuffer();

      const unsized = { providerType: 's3', externalId: 'Backups/unsized.bin' };
      expect((await provider.download(unsized, { maxBytes: 64 })).length).toBe(64);
      await expect(provider.download(unsized, { maxBytes: 32 })).rejects.toBeInstanceOf(
        PayloadTooLargeError
      );
    } finally {
      server.stop(true);
    }
  });
});
