import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Readable } from 'node:stream';
import type { UserProvider } from '../../../db/schema';
import { ValidationError } from '../../../errors';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import {
  blockPrivateProviderEndpoints,
  usePrivateProviderEndpoints,
} from '../../../test-helpers/outbound';
import { encrypt } from '../../../utils/encryption';
import { outboundResolver, urlForAddress } from '../../../utils/outbound-url';
import { resolveModelSettings } from '../domains/model/model-registry';
import { postModelJson } from '../domains/model/model-transport';
import { s3RequestHandler } from '../domains/storage/s3-compat-provider';

let ctx: TestApp;
const stubLookup = outboundResolver.lookup;
const stubConnectUrl = outboundResolver.connectUrl;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => {
  outboundResolver.lookup = stubLookup;
  outboundResolver.connectUrl = stubConnectUrl;
  globalThis.fetch = realFetch;
  ctx.close();
});

function s3Body(endpoint: string) {
  return {
    domain: 'storage',
    providerType: 's3',
    displayName: 'Bucket',
    credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
    config: { endpoint, bucket: 'photos', region: 'us-east-1' },
  };
}

function modelBody(baseUrl: string) {
  return {
    domain: 'llm',
    providerType: 'openai-compatible',
    displayName: 'Model',
    credentials: { apiKey: 'sk-test' },
    config: { model: 'gpt-4o-mini', baseUrl },
  };
}

function sendS3(request: Record<string, unknown>) {
  const handler = s3RequestHandler as unknown as {
    handle: (request: unknown) => Promise<{
      response: {
        statusCode: number;
        headers: Record<string, string>;
        body: NodeJS.ReadableStream;
      };
    }>;
  };
  return handler.handle({
    protocol: 'https:',
    hostname: 'files.example.com',
    path: '/photos/k',
    method: 'GET',
    headers: {},
    ...request,
  });
}

function insertStoredS3Provider(endpoint: string): string {
  const id = `stored-s3-${Math.random().toString(36).slice(2)}`;
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', 's3', 'Stored', ?, ?, 'active')`,
    [
      id,
      ctx.user.id,
      encrypt(JSON.stringify({ accessKeyId: 'a', secretAccessKey: 'b' }), {
        rowId: id,
        userId: ctx.user.id,
        domain: 'storage',
      }),
      JSON.stringify({ endpoint, bucket: 'photos', region: 'us-east-1' }),
    ]
  );
  return id;
}

describe('provider endpoints when the admin allows private endpoints', () => {
  test.each([
    'http://169.254.169.254',
    'http://[fe80::1]',
    'http://[fd00:ec2::254]',
    'http://metadata.google.internal',
  ])('storage endpoint %s is rejected', async (endpoint) => {
    const res = await ctx.authed('POST', '/api/v1/providers', s3Body(endpoint));
    expect(res.status).toBe(400);
    expect(ctx.sqlite.query('SELECT COUNT(*) AS n FROM user_providers').get()).toEqual({ n: 0 });
  });

  test('a model base URL on a link-local address is rejected', async () => {
    const res = await ctx.authed(
      'POST',
      '/api/v1/providers',
      modelBody('http://169.254.169.254/v1')
    );
    expect(res.status).toBe(400);
  });

  test.each([
    'http://localhost:9000',
    'http://192.168.1.20:9000',
    'https://10.0.0.5',
    'https://s3.example.com',
  ])('storage endpoint %s is accepted', async (endpoint) => {
    const res = await ctx.authed('POST', '/api/v1/providers', s3Body(endpoint));
    expect(res.status).toBe(201);
  });

  test('a self-hosted model base URL is accepted', async () => {
    const res = await ctx.authed(
      'POST',
      '/api/v1/providers',
      modelBody('http://localhost:11434/v1')
    );
    expect(res.status).toBe(201);
  });

  test('an update cannot move an endpoint to a link-local host', async () => {
    const created = await ctx.authed('POST', '/api/v1/providers', s3Body('https://s3.example.com'));
    const { id } = (await json<DataEnvelope<{ id: string }>>(created)).data;
    const res = await ctx.authed('PUT', `/api/v1/providers/${id}`, {
      config: { endpoint: 'http://169.254.169.254', bucket: 'photos', region: 'us-east-1' },
    });
    expect(res.status).toBe(400);
  });
});

describe('provider endpoints by default, with private endpoints blocked', () => {
  blockPrivateProviderEndpoints();

  test.each([
    'https://127.0.0.1:9000',
    'https://10.0.0.5',
    'http://s3.example.com',
    'https://localhost:9000',
  ])('storage endpoint %s is rejected', async (endpoint) => {
    const res = await ctx.authed('POST', '/api/v1/providers', s3Body(endpoint));
    expect(res.status).toBe(400);
  });

  test.each(['https://192.168.0.10/v1', 'https://[::1]/v1', 'http://localhost:11434/v1'])(
    'model base URL %s is rejected',
    async (baseUrl) => {
      const res = await ctx.authed('POST', '/api/v1/providers', modelBody(baseUrl));
      expect(res.status).toBe(400);
    }
  );

  test('a public https endpoint is accepted', async () => {
    const res = await ctx.authed('POST', '/api/v1/providers', s3Body('https://s3.example.com'));
    expect(res.status).toBe(201);
  });

  test('an S3 provider whose host resolves to a private address never sends', async () => {
    outboundResolver.lookup = async () => ['10.0.0.9'];
    await expect(sendS3({})).rejects.toThrow(ValidationError);
  });

  test('a stored row saved while LAN hosts were allowed is refused when tested', async () => {
    const id = insertStoredS3Provider('http://192.168.1.20:9000');
    const res = await ctx.authed('POST', `/api/v1/providers/${id}/test`);
    expect(res.status).toBe(400);
  });
});

describe('provider endpoints with an admin allowlist', () => {
  usePrivateProviderEndpoints({ block: false, allow: '192.168.1.20:9000' });

  test('the allowlisted host and port is accepted', async () => {
    const res = await ctx.authed('POST', '/api/v1/providers', s3Body('http://192.168.1.20:9000'));
    expect(res.status).toBe(201);
  });

  test.each(['http://192.168.1.20:80', 'http://192.168.1.21:9000', 'http://localhost:9000'])(
    'storage endpoint %s outside the allowlist is rejected',
    async (endpoint) => {
      const res = await ctx.authed('POST', '/api/v1/providers', s3Body(endpoint));
      expect(res.status).toBe(400);
    }
  );

  test('a name that resolves to a public address over plain http is never sent to', async () => {
    outboundResolver.lookup = async () => ['93.184.215.14'];
    const sent: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      sent.push(String(input));
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    await expect(sendS3({ protocol: 'http:', hostname: 's3.example.com' })).rejects.toThrow(
      'S3 endpoint must use https'
    );
    expect(sent).toEqual([]);
  });
});

describe('stored provider rows are checked when used', () => {
  test('a stored row with a link-local endpoint is refused by the health check', async () => {
    const id = insertStoredS3Provider('http://169.254.169.254');
    const res = await ctx.authed('POST', `/api/v1/providers/${id}/test`);
    expect(res.status).toBe(400);
  });

  test('an S3 provider whose host resolves to a link-local address never sends', async () => {
    outboundResolver.lookup = async () => ['169.254.169.254'];
    await expect(sendS3({})).rejects.toThrow(ValidationError);
  });
});

describe('model transport', () => {
  test('does not call a host that resolves to a disallowed address', async () => {
    outboundResolver.lookup = async () => ['169.254.169.254'];
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response('{}');
    }) as unknown as typeof fetch;
    await expect(
      postModelJson({
        domain: 'LLM',
        providerType: 'openai-compatible',
        model: 'm',
        url: 'https://models.example.com/v1/chat/completions',
        body: {},
        timeoutMs: 1000,
      })
    ).rejects.toThrow(ValidationError);
    expect(calls).toBe(0);
  });

  test('does not follow redirects', async () => {
    let redirect: RequestInit['redirect'];
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      redirect = init?.redirect;
      return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } });
    }) as unknown as typeof fetch;
    await expect(
      postModelJson({
        domain: 'LLM',
        providerType: 'openai-compatible',
        model: 'm',
        url: 'https://models.example.com/v1/chat/completions',
        body: {},
        timeoutMs: 1000,
      })
    ).rejects.toThrow('HTTP 302');
    expect(redirect).toBe('manual');
  });
});

function storedModelRow(baseUrl: string): UserProvider {
  return {
    id: 'stored-llm',
    userId: 'u1',
    domain: 'llm',
    providerType: 'openai-compatible',
    providerAccountId: null,
    displayName: 'Stored',
    credentials: encrypt(JSON.stringify({ apiKey: 'sk-test' }), {
      rowId: 'stored-llm',
      userId: 'u1',
      domain: 'llm',
    }),
    config: { model: 'gpt-4o-mini', baseUrl },
    status: 'active',
    lastSyncAt: null,
    lastErrorCode: null,
    lastCheckedAt: null,
    failureCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('stored model rows and model updates', () => {
  test('a stored model row with a link-local base URL is refused when resolved', () => {
    expect(() => resolveModelSettings(storedModelRow('http://169.254.169.254/v1'), 'LLM')).toThrow(
      ValidationError
    );
    expect(resolveModelSettings(storedModelRow('http://localhost:11434/v1'), 'LLM').baseUrl).toBe(
      'http://localhost:11434/v1'
    );
  });

  test('an update cannot move a model base URL to a link-local host', async () => {
    const created = await ctx.authed(
      'POST',
      '/api/v1/providers',
      modelBody('https://api.openai.com/v1')
    );
    expect(created.status).toBe(201);
    const { id } = (await json<DataEnvelope<{ id: string }>>(created)).data;
    const res = await ctx.authed('PUT', `/api/v1/providers/${id}`, {
      config: { model: 'gpt-4o-mini', baseUrl: 'http://169.254.169.254/v1' },
    });
    expect(res.status).toBe(400);
  });
});

interface SeenRequest {
  method: string;
  host: string | null;
  contentLength: string | null;
  path: string;
  body: string;
}

function startLoopbackServer(respond: (req: Request) => Response) {
  const seen: SeenRequest[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      seen.push({
        method: req.method,
        host: req.headers.get('host'),
        contentLength: req.headers.get('content-length'),
        path: `${url.pathname}${url.search}`,
        body: await req.text(),
      });
      return respond(req);
    },
  });
  return { seen, port: server.port, stop: () => server.stop(true) };
}

describe('outbound requests connect to the validated address', () => {
  test('a model request reaches the validated address and keeps the original host', async () => {
    const server = startLoopbackServer(() => Response.json({ ok: true }));
    let lookups = 0;
    outboundResolver.lookup = async () => {
      lookups++;
      return lookups === 1 ? ['127.0.0.1'] : ['169.254.169.254'];
    };
    outboundResolver.connectUrl = urlForAddress;
    try {
      const body = await postModelJson<{ ok: boolean }>({
        domain: 'LLM',
        providerType: 'openai-compatible',
        model: 'm',
        url: `http://models.pinned.test:${server.port}/v1/chat/completions`,
        body: { hello: 'world' },
        timeoutMs: 5000,
      });
      expect(body).toEqual({ ok: true });
      expect(lookups).toBe(1);
      expect(server.seen).toHaveLength(1);
      expect(server.seen[0]?.host).toBe(`models.pinned.test:${server.port}`);
      expect(server.seen[0]?.path).toBe('/v1/chat/completions');
    } finally {
      server.stop();
    }
  });

  test('S3 requests reach the validated address and keep the original host', async () => {
    const server = startLoopbackServer((req) =>
      req.method === 'GET'
        ? new Response('photo-bytes', { headers: { etag: '"abc"' } })
        : new Response(null, { status: 200 })
    );
    let lookups = 0;
    outboundResolver.lookup = async () => {
      lookups++;
      return ['127.0.0.1'];
    };
    outboundResolver.connectUrl = urlForAddress;
    const target = { protocol: 'http:', hostname: 'minio.pinned.test', port: server.port };
    try {
      const put = await sendS3({
        ...target,
        method: 'PUT',
        path: '/photos/a%20b.jpg',
        headers: { 'content-type': 'image/jpeg' },
        body: Buffer.from('uploaded'),
      });
      expect(put.response.statusCode).toBe(200);

      const get = await sendS3({
        ...target,
        path: '/photos',
        query: { 'list-type': '2', prefix: "VROOM/it's (1)*", uploads: null },
      });
      expect(get.response.statusCode).toBe(200);
      expect(get.response.headers.etag).toBe('"abc"');
      expect(get.response.body).toBeInstanceOf(Readable);
      const chunks: Buffer[] = [];
      for await (const chunk of get.response.body) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks).toString()).toBe('photo-bytes');

      expect(server.seen.map((r) => r.method)).toEqual(['PUT', 'GET']);
      expect(server.seen.every((r) => r.host === `minio.pinned.test:${server.port}`)).toBe(true);
      expect(server.seen[0]?.body).toBe('uploaded');
      expect(server.seen[1]?.path).toBe(
        '/photos?list-type=2&prefix=VROOM%2Fit%27s%20%281%29%2A&uploads'
      );
      expect(lookups).toBe(2);
    } finally {
      server.stop();
    }
  });

  test('a streamed S3 request body is sent with its content length', async () => {
    const server = startLoopbackServer(() => new Response(null, { status: 200 }));
    outboundResolver.lookup = async () => ['127.0.0.1'];
    outboundResolver.connectUrl = urlForAddress;
    try {
      const put = await sendS3({
        protocol: 'http:',
        hostname: 'minio.pinned.test',
        port: server.port,
        method: 'PUT',
        path: '/photos/streamed.jpg',
        body: Readable.from([Buffer.from('up'), Buffer.from('loaded')]),
      });
      expect(put.response.statusCode).toBe(200);
      expect(server.seen[0]?.body).toBe('uploaded');
      expect(server.seen[0]?.contentLength).toBe('8');
    } finally {
      server.stop();
    }
  });
});
