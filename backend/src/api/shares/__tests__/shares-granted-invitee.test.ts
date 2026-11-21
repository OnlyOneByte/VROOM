import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface GrantedShare {
  sharedWithId: string;
  sharedWithEmail: string;
  sharedWithName: string;
}

describe('GET /api/v1/shares/granted names the invitee', () => {
  test('each share carries the invitee email and display name, not only their id', async () => {
    const b = await createInvitee(ctx, 'granted-invitee', 'Sam Rivera');
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const invited = await ctx.authed('POST', '/api/v1/shares', {
      vehicleId,
      email: b.email,
      level: 'viewer',
    });
    expect(invited.status).toBe(201);

    const res = await ctx.authed('GET', '/api/v1/shares/granted');
    const body = await json<DataEnvelope<GrantedShare[]>>(res);

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      sharedWithId: b.id,
      sharedWithEmail: b.email,
      sharedWithName: 'Sam Rivera',
    });
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
