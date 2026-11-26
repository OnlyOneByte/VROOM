import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

interface GrantedShare {
  id: string;
  status: string;
  sharedWithId: string;
  sharedWithEmail: string | null;
  sharedWithName: string | null;
}

describe('GET /api/v1/shares/granted names the invitee', () => {
  async function granted(): Promise<GrantedShare[]> {
    const res = await ctx.authed('GET', '/api/v1/shares/granted');
    expect(res.status).toBe(200);
    return (await json<DataEnvelope<GrantedShare[]>>(res)).data;
  }

  test('an accepted share carries the invitee email and display name', async () => {
    const b = await createInvitee(ctx, 'granted-invitee', 'Sam Rivera');
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const invited = await json<DataEnvelope<GrantedShare>>(
      await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: b.email, level: 'viewer' })
    );
    expect((await b.request('POST', `/api/v1/shares/${invited.data.id}/accept`)).status).toBe(200);

    expect(await granted()).toMatchObject([
      {
        status: 'accepted',
        sharedWithId: b.id,
        sharedWithEmail: b.email,
        sharedWithName: 'Sam Rivera',
      },
    ]);
  });

  test('a pending share shows the email the owner typed, but not the invitee name', async () => {
    const b = await createInvitee(ctx, 'granted-pending', 'Victim Person');
    const vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: '3', year: 2019 });
    await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: b.email, level: 'viewer' });

    const [row] = await granted();
    expect(row).toMatchObject({
      status: 'pending',
      sharedWithEmail: b.email,
      sharedWithName: null,
    });
    expect(JSON.stringify(row)).not.toContain('Victim Person');
  });

  test('a planted pending row with no invited email names nobody, so a user id cannot turn into an email', async () => {
    const b = await createInvitee(ctx, 'granted-planted', 'Victim Person');
    const vehicleId = await seedVehicle(ctx, { make: 'Kia', model: 'Rio', year: 2018 });
    ctx.sqlite.run(
      `INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status, created_at, updated_at)
       VALUES ('planted', ?, ?, ?, 'viewer', 'pending', 0, 0)`,
      [vehicleId, ctx.user.id, b.id]
    );

    const [row] = await granted();
    expect(row).toMatchObject({ status: 'pending', sharedWithEmail: null, sharedWithName: null });
    expect(JSON.stringify(row)).not.toContain(b.email);
    expect(JSON.stringify(row)).not.toContain('Victim Person');
  });

  test("the invitee's own granted list stays empty: names are only shown to the owner", async () => {
    const b = await createInvitee(ctx, 'granted-invitee-2', 'Jo Taylor');
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Corolla', year: 2020 });
    await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: b.email, level: 'editor' });

    const res = await b.request('GET', '/api/v1/shares/granted');
    const body = await json<DataEnvelope<GrantedShare[]>>(res);

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });
});
