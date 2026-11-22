import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, json, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface InviteBody {
  success: boolean;
  data: Record<string, unknown>;
  message: string;
}

function seedUser(id: string, email: string): void {
  ctx.sqlite.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
    id,
    email,
    'Someone',
  ]);
}

function shareRow(id: unknown): { shared_with_id: string | null; invited_email: string } {
  return ctx.sqlite
    .query('SELECT shared_with_id, invited_email FROM vehicle_shares WHERE id = ?')
    .get(String(id)) as { shared_with_id: string | null; invited_email: string };
}

async function invite(vehicleId: string, email: string) {
  const res = await ctx.authed('POST', '/api/v1/shares', { vehicleId, email, level: 'viewer' });
  return { status: res.status, body: await json<InviteBody>(res) };
}

function withoutRowFields(body: InviteBody) {
  const {
    id: _id,
    vehicleId: _vehicleId,
    invitedEmail: _email,
    sharedWithEmail: _shown,
    createdAt: _created,
    updatedAt: _updated,
    ...rest
  } = body.data;
  return { ...body, data: rest };
}

describe('POST /api/v1/shares answers the same way for every email', () => {
  test('an email with an account and one without get the same status and body', async () => {
    const first = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const second = await seedVehicle(ctx, { make: 'Mazda', model: '3', year: 2022 });
    seedUser('u-known', 'known@example.com');

    const known = await invite(first, 'known@example.com');
    const unknown = await invite(second, 'nobody-here@example.com');

    expect(known.status).toBe(201);
    expect(unknown.status).toBe(201);
    expect(Object.keys(known.body.data).sort()).toEqual(Object.keys(unknown.body.data).sort());
    expect(withoutRowFields(known.body)).toEqual(withoutRowFields(unknown.body));
    expect(known.body.data.sharedWithId).toBeNull();
    expect(shareRow(known.body.data.id).shared_with_id).toBe('u-known');
    expect(shareRow(unknown.body.data.id).shared_with_id).toBeNull();
  });

  test('the account lookup ignores case and the stored email is lowercased', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    seedUser('u-mixed', 'Mixed.Case@Example.com');

    const { status, body } = await invite(vehicleId, 'MIXED.case@example.COM');

    expect(status).toBe(201);
    expect(shareRow(body.data.id)).toEqual({
      shared_with_id: 'u-mixed',
      invited_email: 'mixed.case@example.com',
    });
  });

  test('a second invite to the same email for the same vehicle is a conflict either way', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    seedUser('u-known', 'known@example.com');

    expect((await invite(vehicleId, 'nobody-here@example.com')).status).toBe(201);
    expect((await invite(vehicleId, 'Nobody-Here@example.com')).status).toBe(409);
    expect((await invite(vehicleId, 'known@example.com')).status).toBe(201);
    expect((await invite(vehicleId, 'KNOWN@example.com')).status).toBe(409);
  });

  test('the owner sees every unaccepted invite as pending, with no invitee id', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    seedUser('u-known', 'known@example.com');
    await invite(vehicleId, 'nobody-here@example.com');
    await invite(vehicleId, 'known@example.com');

    const res = await ctx.authed('GET', '/api/v1/shares/granted');
    const granted = (await json<{ data: Record<string, unknown>[] }>(res)).data;

    expect(
      granted.map((s) => [s.sharedWithEmail, s.status, s.sharedWithId, s.sharedWithName])
    ).toEqual([
      ['nobody-here@example.com', 'pending', null, null],
      ['known@example.com', 'pending', null, null],
    ]);
  });
});

describe('a pending invite attaches when that email signs up', () => {
  test('two concurrent invites to the same new email leave one pending invite', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });

    const results = await Promise.all([
      invite(vehicleId, 'race@example.com'),
      invite(vehicleId, 'race@example.com'),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      ctx.sqlite
        .query("SELECT count(*) AS n FROM vehicle_shares WHERE invited_email = 'race@example.com'")
        .get()
    ).toEqual({ n: 1 });
  });

  test('the new account receives the invite and the owner sees no change', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const { body } = await invite(vehicleId, 'later@example.com');
    const grantedBefore = await (await ctx.authed('GET', '/api/v1/shares/granted')).text();

    const { resolveNewUser } = await import('../../auth/routes');
    const result = await resolveNewUser('google', {
      providerAccountId: 'g-later',
      email: 'Later@Example.com',
      displayName: 'Later',
    });
    if (!('userId' in result)) throw new Error('expected a new user');

    expect(shareRow(body.data.id).shared_with_id).toBe(result.userId);
    expect(await (await ctx.authed('GET', '/api/v1/shares/granted')).text()).toBe(grantedBefore);
  });
});

describe('an invite only reaches an account its email identifies', () => {
  async function signUp(email: string, providerAccountId: string) {
    const { resolveNewUser } = await import('../../auth/routes');
    const result = await resolveNewUser('google', {
      providerAccountId,
      email,
      displayName: 'Someone',
    });
    if (!('userId' in result)) throw new Error('expected a new user');
    return result.userId;
  }

  function insertPendingInvite(id: string, vehicleId: string, email: string): void {
    ctx.sqlite.run(
      "INSERT INTO vehicle_shares (id, vehicle_id, owner_id, level, status, invited_email) VALUES (?, ?, ?, 'viewer', 'pending', ?)",
      [id, vehicleId, ctx.user.id, email]
    );
  }

  test('with two accounts that differ only by case, the exact one gets the invite', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    seedUser('u-exact', 'twin@example.com');
    seedUser('u-other', 'Twin@Example.com');

    const { body } = await invite(vehicleId, 'TWIN@example.com');

    expect(shareRow(body.data.id).shared_with_id).toBe('u-exact');
  });

  test('with two accounts and no exact match, the invite stays unattached', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    seedUser('u-one', 'Pair@Example.com');
    seedUser('u-two', 'PAIR@example.com');

    const { body } = await invite(vehicleId, 'pair@example.com');

    expect(shareRow(body.data.id).shared_with_id).toBeNull();
  });

  test('a signup whose email matches another account only by case attaches nothing', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    seedUser('u-first', 'Dup@Example.com');
    const { body } = await invite(vehicleId, 'dup@example.com');
    expect(shareRow(body.data.id).shared_with_id).toBe('u-first');
    insertPendingInvite('share-loose', vehicleId, 'dup@example.com');

    await signUp('DUP@example.com', 'g-dup');

    expect(shareRow('share-loose').shared_with_id).toBeNull();
  });

  test('a signup still succeeds when its invites cannot all attach', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    insertPendingInvite('share-lower', vehicleId, 'late@example.com');
    insertPendingInvite('share-mixed', vehicleId, 'Late@example.com');

    const userId = await signUp('Late@example.com', 'g-late');

    expect(
      ctx.sqlite.query('SELECT id FROM users WHERE id = ?').get(userId) as { id: string }
    ).toEqual({ id: userId });
    expect(shareRow('share-lower').shared_with_id).toBeNull();
    expect(shareRow('share-mixed').shared_with_id).toBeNull();
  });
});
