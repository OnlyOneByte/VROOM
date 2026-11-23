import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface ProviderResponse {
  id: string;
  config: Record<string, unknown>;
  secretsSet: string[];
  credentials?: unknown;
}

const S3_CONFIG = { endpoint: 'https://s3.example.com', bucket: 'b', region: 'us-east-1' };
const S3_SECRETS = { accessKeyId: 'AKIA-TEST', secretAccessKey: 'shh' };
const LLM_CONFIG = { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' };

async function create(body: Record<string, unknown>): Promise<ProviderResponse> {
  const res = await ctx.authed('POST', '/api/v1/providers', body);
  expect(res.status, await res.clone().text()).toBe(201);
  return (await json<DataEnvelope<ProviderResponse>>(res)).data;
}

const createS3 = () =>
  create({
    domain: 'storage',
    providerType: 's3',
    displayName: 'S3',
    credentials: S3_SECRETS,
    config: S3_CONFIG,
  });

const createLlm = () =>
  create({
    domain: 'llm',
    providerType: 'openai-compatible',
    displayName: 'LLM',
    credentials: { apiKey: 'sk-test' },
    config: LLM_CONFIG,
  });

describe('provider responses say which secrets are saved, never what they are', () => {
  test('create and list carry secretsSet and no secret values', async () => {
    const created = await createS3();
    expect(created.secretsSet).toEqual(['accessKeyId', 'secretAccessKey']);
    const listRes = await ctx.authed('GET', '/api/v1/providers');
    const listed = await listRes.text();
    expect(listed).not.toContain('AKIA-TEST');
    expect(listed).not.toContain('shh');
    const row = (JSON.parse(listed) as DataEnvelope<ProviderResponse[]>).data.find(
      (p) => p.id === created.id
    );
    expect(row?.secretsSet).toEqual(['accessKeyId', 'secretAccessKey']);
    expect(row?.credentials).toBeUndefined();
  });

  test('a provider whose stored secret cannot be read reports none saved', async () => {
    const created = await createLlm();
    ctx.sqlite.run("UPDATE user_providers SET credentials = 'garbage' WHERE id = ?", [created.id]);
    const list = (
      await json<DataEnvelope<ProviderResponse[]>>(await ctx.authed('GET', '/api/v1/providers'))
    ).data;
    expect(list.find((p) => p.id === created.id)?.secretsSet).toEqual([]);
  });
});

describe('changing where a secret is sent asks for the secret again', () => {
  test.each([
    [
      'an S3 endpoint',
      createS3,
      { ...S3_CONFIG, endpoint: 'https://other.example.com' },
      'Access Key ID',
      'Endpoint',
    ],
    [
      'an LLM base URL',
      createLlm,
      { ...LLM_CONFIG, baseUrl: 'https://other.example.com/v1' },
      'API key',
      'Base URL',
    ],
  ])('%s change without the secret is a 400', async (_label, make, config, secret, field) => {
    const created = await make();
    const res = await ctx.authed('PUT', `/api/v1/providers/${created.id}`, { config });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(`Enter the ${secret} again: the ${field} changed`);
  });

  test('the same change with the secret resent is saved', async () => {
    const created = await createS3();
    const res = await ctx.authed('PUT', `/api/v1/providers/${created.id}`, {
      config: { ...S3_CONFIG, endpoint: 'https://other.example.com' },
      credentials: S3_SECRETS,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await json<DataEnvelope<ProviderResponse>>(res)).data.config.endpoint).toBe(
      'https://other.example.com'
    );
  });

  test('other edits keep the saved secret without resending it', async () => {
    const created = await createLlm();
    const res = await ctx.authed('PUT', `/api/v1/providers/${created.id}`, {
      displayName: 'Renamed',
      config: { ...LLM_CONFIG, model: 'gpt-4o' },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await json<DataEnvelope<ProviderResponse>>(res)).data.secretsSet).toEqual(['apiKey']);
  });

  test('resending the unchanged endpoint is not a change', async () => {
    const created = await createS3();
    const res = await ctx.authed('PUT', `/api/v1/providers/${created.id}`, { config: S3_CONFIG });
    expect(res.status, await res.clone().text()).toBe(200);
  });
});
