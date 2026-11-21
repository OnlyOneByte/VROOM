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
  test('the new account receives the invite', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const { body } = await invite(vehicleId, 'later@example.com');

    const { resolveNewUser } = await import('../../auth/routes');
    const result = await resolveNewUser('google', {
      providerAccountId: 'g-later',
      email: 'Later@Example.com',
      displayName: 'Later',
    });
    if (!('userId' in result)) throw new Error('expected a new user');

    expect(shareRow(body.data.id).shared_with_id).toBe(result.userId);
  });
});
