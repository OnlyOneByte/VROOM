import { S3CompatProvider } from '../api/providers/domains/storage/s3-compat-provider';
import { outboundResolver } from '../utils/outbound-url';

interface SeenRequest {
  method: string;
  path: string;
  host: string | null;
  signed: boolean;
  bodyLength: number;
}

const objects = new Map<string, Uint8Array>();
const seen: SeenRequest[] = [];

function listXml(prefix: string): string {
  const contents = [...objects.entries()]
    .filter(([key]) => key.startsWith(`photos/${prefix}`))
    .map(
      ([key, body]) =>
        `<Contents><Key>${key.slice('photos/'.length)}</Key><Size>${body.length}</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>`
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>photos</Name><Prefix>${prefix}</Prefix><KeyCount>${objects.size}</KeyCount><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
}

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
    const stored = objects.get(key);
    if (!stored) return new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
    return new Response(stored, { headers: { 'content-length': String(stored.length) } });
  },
});

outboundResolver.lookup = async () => ['127.0.0.2', '127.0.0.1'];

const provider = new S3CompatProvider(
  { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
  { endpoint: `http://s3.test:${server.port}`, bucket: 'photos', region: 'us-east-1' }
);

const payload = Buffer.from('real s3 client bytes');
const healthy = await provider.healthCheck();
const ref = await provider.upload({
  buffer: payload,
  fileName: 'receipt.jpg',
  mimeType: 'image/jpeg',
  entityType: 'expense',
  entityId: 'e1',
  pathHint: '',
  rawPath: 'receipts',
});
const downloaded = (await provider.download(ref)).toString();
const listed = (await provider.list('receipts')).map((f) => f.key);
await provider.delete(ref);

server.stop(true);
console.log(JSON.stringify({ healthy, key: ref.externalId, downloaded, listed, seen }));
