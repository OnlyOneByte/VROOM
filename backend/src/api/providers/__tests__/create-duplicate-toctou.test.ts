import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { storePending } from '../../../utils/pending-credentials';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

function drivePayload(accountEmail: string) {
  const nonce = crypto.randomUUID();
  storePending(ctx.user.id, nonce, `refresh-${nonce}`, accountEmail, 'google-drive');
  return {
    domain: 'storage',
    providerType: 'google-drive',
    displayName: 'Backups',
    credentials: {},
    nonce,
  };
}

async function providerRowCount(): Promise<number> {
  const row = (await ctx.sql.get(
    `SELECT COUNT(*) AS n FROM user_providers WHERE user_id = ? AND domain = 'storage'`,
    [ctx.user.id]
  )) as { n: number };
  return row.n;
}

describe('POST /providers duplicate check is atomic with the insert', () => {
  test('two concurrent creates for the same account yield one row and one 409', async () => {
    const [first, second] = await Promise.all([
      ctx.authed('POST', '/api/v1/providers', drivePayload('alice@example.com')),
      ctx.authed('POST', '/api/v1/providers', drivePayload('alice@example.com')),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(await providerRowCount()).toBe(1);
  });

  test('concurrent creates for DIFFERENT accounts both persist', async () => {
    const [first, second] = await Promise.all([
      ctx.authed('POST', '/api/v1/providers', drivePayload('alice@example.com')),
      ctx.authed('POST', '/api/v1/providers', drivePayload('bob@example.com')),
    ]);

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(await providerRowCount()).toBe(2);
  });

  test('a sequential duplicate is still a 409 (the check itself is unchanged)', async () => {
    const first = await ctx.authed('POST', '/api/v1/providers', drivePayload('alice@example.com'));
    expect(first.status).toBe(201);

    const second = await ctx.authed('POST', '/api/v1/providers', drivePayload('alice@example.com'));
    expect(second.status).toBe(409);
    expect(await providerRowCount()).toBe(1);
  });
});
