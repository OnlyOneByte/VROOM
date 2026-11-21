import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ValidationError } from '../../../errors';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { blockPrivateProviderEndpoints } from '../../../test-helpers/outbound';
import { encrypt } from '../../../utils/encryption';
import { outboundResolver } from '../../../utils/outbound-url';
import { postModelJson } from '../domains/model/model-transport';
import { S3CompatProvider } from '../domains/storage/s3-compat-provider';

let ctx: TestApp;
const stubLookup = outboundResolver.lookup;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => {
  outboundResolver.lookup = stubLookup;
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

function insertStoredS3Provider(endpoint: string): string {
  const id = `stored-s3-${Math.random().toString(36).slice(2)}`;
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES (?, ?, 'storage', 's3', 'Stored', ?, ?, 'active')`,
    [
      id,
      ctx.user.id,
      encrypt(JSON.stringify({ accessKeyId: 'a', secretAccessKey: 'b' })),
      JSON.stringify({ endpoint, bucket: 'photos', region: 'us-east-1' }),
    ]
  );
  return id;
}

describe('provider endpoints by default', () => {
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

describe('provider endpoints with private endpoints blocked', () => {
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
    const provider = new S3CompatProvider(
      { accessKeyId: 'a', secretAccessKey: 'b' },
      { endpoint: 'https://files.example.com', bucket: 'photos', region: 'us-east-1' }
    );
    await expect(
      provider.download({ providerType: 's3', externalId: 'k', storageRef: 'k' } as never)
    ).rejects.toThrow(ValidationError);
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
    const provider = new S3CompatProvider(
      { accessKeyId: 'a', secretAccessKey: 'b' },
      { endpoint: 'https://files.example.com', bucket: 'photos', region: 'us-east-1' }
    );
    await expect(
      provider.download({ providerType: 's3', externalId: 'k', storageRef: 'k' } as never)
    ).rejects.toThrow(ValidationError);
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
