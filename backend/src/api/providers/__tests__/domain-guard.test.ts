import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

// Auth-domain providers are sign-in identities, managed only by the auth flow. The provider routes
// must refuse to modify or delete them, and leave the row untouched.

let ctx: TestApp;
let authProviderId: string;

beforeEach(async () => {
  ctx = await createTestApp();
  const { db } = await import('../../../db/connection');
  const schema = await import('../../../db/schema');
  const [row] = await db
    .insert(schema.userProviders)
    .values({
      userId: ctx.user.id,
      domain: 'auth',
      providerType: 'google',
      providerAccountId: `acct-${ctx.user.id}`,
      displayName: 'Google sign-in',
      credentials: 'opaque',
      status: 'active',
    })
    .returning();
  authProviderId = row.id;
});

async function storedDisplayName(): Promise<string | undefined> {
  const { db } = await import('../../../db/connection');
  const schema = await import('../../../db/schema');
  const [row] = await db
    .select()
    .from(schema.userProviders)
    .where(eq(schema.userProviders.id, authProviderId));
  return row?.displayName;
}

describe('Provider routes refuse auth-domain rows', () => {
  test('PUT rejects an auth-domain provider with 400 and does not rename it', async () => {
    const res = await ctx.authed('PUT', `/api/v1/providers/${authProviderId}`, {
      displayName: 'Renamed',
    });

    expect(res.status).toBe(400);
    expect(await storedDisplayName()).toBe('Google sign-in');
  });

  test('DELETE rejects an auth-domain provider with 400 and keeps the row', async () => {
    const res = await ctx.authed('DELETE', `/api/v1/providers/${authProviderId}`);

    expect(res.status).toBe(400);
    expect(await storedDisplayName()).toBe('Google sign-in');
  });
});
