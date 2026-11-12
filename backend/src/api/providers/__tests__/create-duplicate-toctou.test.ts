import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

function s3Payload(accountEmail: string) {
  return {
    domain: 'storage',
    providerType: 's3',
    displayName: 'Backups',
    credentials: { accessKeyId: 'AKIA', secretAccessKey: 'secret' },
    config: {
      endpoint: 'https://s3.example.com',
      bucket: 'vroom',
      region: 'us-east-1',
      accountEmail,
    },
  };
}

function providerRowCount(): number {
  const row = ctx.sqlite
    .query(`SELECT COUNT(*) AS n FROM user_providers WHERE user_id = ? AND domain = 'storage'`)
    .get(ctx.user.id) as { n: number };
  return row.n;
}

describe('POST /providers duplicate check is atomic with the insert', () => {
  test('two concurrent creates for the same account yield one row and one 409', async () => {
    const [first, second] = await Promise.all([
      ctx.authed('POST', '/api/v1/providers', s3Payload('alice@example.com')),
      ctx.authed('POST', '/api/v1/providers', s3Payload('alice@example.com')),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(providerRowCount()).toBe(1);
  });

  test('concurrent creates for DIFFERENT accounts both persist', async () => {
    const [first, second] = await Promise.all([
      ctx.authed('POST', '/api/v1/providers', s3Payload('alice@example.com')),
      ctx.authed('POST', '/api/v1/providers', s3Payload('bob@example.com')),
    ]);

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(providerRowCount()).toBe(2);
  });

  test('a sequential duplicate is still a 409 (the check itself is unchanged)', async () => {
    const first = await ctx.authed('POST', '/api/v1/providers', s3Payload('alice@example.com'));
    expect(first.status).toBe(201);

    const second = await ctx.authed('POST', '/api/v1/providers', s3Payload('alice@example.com'));
    expect(second.status).toBe(409);
    expect(providerRowCount()).toBe(1);
  });
});
