/**
 * POST /providers must not admit two providers for the same (user, domain, type, account).
 *
 * The handler reads the user's existing providers of that domain+type, rejects a config whose
 * `accountEmail` already exists, and inserts — a classic check-then-act. It is wrapped in a
 * transaction so the two halves are one atomic step, but that only holds while the callback is
 * SYNCHRONOUS: bun-sqlite is a synchronous dialect, so an `async` callback hands back a pending
 * promise and each awaited statement autocommits on its own. BEGIN/COMMIT then wrap nothing, the
 * duplicate check and the insert land in separate turns of the event loop, and a double-submitted
 * "Connect" (or a replayed OAuth callback) interleaves between them. `user_providers` carries only a
 * NON-unique (user_id, domain) index, so nothing downstream catches the second row.
 *
 * The invariant pinned here: of two concurrent creates for the same account, exactly one persists
 * and the other is told it is a conflict.
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules — keep static imports to the
 * harness + bun:test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

/**
 * An s3 create payload. s3 is the type whose `config` reaches the duplicate check verbatim
 * (google-drive resolves its `accountEmail` from a one-shot OAuth nonce that cannot be replayed over
 * HTTP here), so it is the only way to drive the real check-then-act from the outside.
 */
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
