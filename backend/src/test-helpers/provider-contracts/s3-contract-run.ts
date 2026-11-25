import { S3CompatProvider } from '../../api/providers/domains/storage/s3-compat-provider';
import { ALLOW_PRIVATE, outboundResolver } from '../../utils/outbound-url';
import { STORAGE_CHECKS } from './storage-checks';

const objects = new Map<string, Uint8Array>();

function listXml(prefix: string): string {
  const contents = [...objects.entries()]
    .map(([key, body]) => [key.slice('bucket/'.length), body] as const)
    .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
    .map(
      ([key, body]) =>
        `<Contents><Key>${key}</Key><Size>${body.length}</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>`
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>bucket</Name><Prefix>${prefix}</Prefix><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const body = new Uint8Array(await req.arrayBuffer());
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

outboundResolver.lookup = async () => ['127.0.0.1'];

const make = () =>
  new S3CompatProvider(
    { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
    { endpoint: `http://s3.test:${server.port}`, bucket: 'bucket', region: 'us-east-1' },
    ALLOW_PRIVATE
  );

const results: { name: string; error: string | null }[] = [];
for (const item of STORAGE_CHECKS) {
  try {
    await item.run(make);
    results.push({ name: item.name, error: null });
  } catch (error) {
    results.push({
      name: item.name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

server.stop(true);
console.log(JSON.stringify(results));
