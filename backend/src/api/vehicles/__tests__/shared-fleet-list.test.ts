import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;
let asB: RequestFn;
let bEmail: string;

beforeEach(async () => {
  ctx = await createTestApp();
  const b = await createInvitee(ctx, 'fleet-invitee', 'Invitee B');
  bEmail = b.email;
  asB = b.request;
});
afterEach(() => ctx.close());

interface VehicleRow {
  id: string;
  make: string;
  sharedAccess?: { level: string; sharedBy: string };
}

async function shareWithB(level: 'viewer' | 'editor'): Promise<[string, string]> {
  const vehicleId = await seedVehicle(ctx, { make: 'Shared', model: 'Car', year: 2021 });
  const res = await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: bEmail, level });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return [vehicleId, body.data.id];
}

describe('GET /vehicles?include=shared fleet list', () => {
  test('an ACCEPTED share makes the owner vehicle appear in B fleet, annotated sharedAccess', async () => {
    const [vehicleId, shareId] = await shareWithB('viewer');
    await asB('POST', `/api/v1/shares/${shareId}/accept`);

    const ownOnly = await json<DataEnvelope<VehicleRow[]>>(await asB('GET', '/api/v1/vehicles'));
    expect(ownOnly.data.find((v) => v.id === vehicleId)).toBeUndefined();

    const withShared = await json<DataEnvelope<VehicleRow[]>>(
      await asB('GET', '/api/v1/vehicles?include=shared')
    );
    const row = withShared.data.find((v) => v.id === vehicleId);
    expect(row, 'shared vehicle should appear with include=shared').toBeDefined();
    expect(row?.sharedAccess?.level).toBe('viewer');
    expect(row?.sharedAccess?.sharedBy).toBe(ctx.user.displayName);
  });

  test('a PENDING (not yet accepted) share does NOT appear in the shared fleet', async () => {
    const [vehicleId] = await shareWithB('editor');
    const withShared = await json<DataEnvelope<VehicleRow[]>>(
      await asB('GET', '/api/v1/vehicles?include=shared')
    );
    expect(withShared.data.find((v) => v.id === vehicleId)).toBeUndefined();
  });

  test('a DECLINED share does NOT appear (no fleet visibility after decline)', async () => {
    const [vehicleId, shareId] = await shareWithB('viewer');
    await asB('POST', `/api/v1/shares/${shareId}/accept`);
    await asB('POST', `/api/v1/shares/${shareId}/decline`);
    const withShared = await json<DataEnvelope<VehicleRow[]>>(
      await asB('GET', '/api/v1/vehicles?include=shared')
    );
    expect(withShared.data.find((v) => v.id === vehicleId)).toBeUndefined();
  });

  test('a non-shared third party never sees the vehicle (no leak)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Private', model: 'Car', year: 2021 });
    const withShared = await json<DataEnvelope<VehicleRow[]>>(
      await asB('GET', '/api/v1/vehicles?include=shared')
    );
    expect(withShared.data.find((v) => v.id === vehicleId)).toBeUndefined();
  });

  test('owned vehicles carry NO sharedAccess annotation', async () => {
    await seedVehicle(ctx, { make: 'Owned', model: 'Car', year: 2021 });
    const list = await json<DataEnvelope<VehicleRow[]>>(
      await ctx.authed('GET', '/api/v1/vehicles?include=shared')
    );
    const owned = list.data.find((v) => v.make === 'Owned');
    expect(owned).toBeDefined();
    expect(owned?.sharedAccess).toBeUndefined();
  });
});

describe('share lifecycle: invite, accept, appear, revoke, disappear', () => {
  test('the owner revoking an accepted share removes the vehicle from the invitee fleet', async () => {
    const [vehicleId, shareId] = await shareWithB('editor');
    expect((await asB('POST', `/api/v1/shares/${shareId}/accept`)).status).toBe(200);

    const afterAccept = await json<DataEnvelope<VehicleRow[]>>(
      await asB('GET', '/api/v1/vehicles?include=shared')
    );
    const accepted = afterAccept.data.find((v) => v.id === vehicleId);
    expect(accepted, 'accepted vehicle is in the invitee fleet').toBeDefined();
    expect(accepted?.sharedAccess?.level).toBe('editor');

    expect((await ctx.authed('DELETE', `/api/v1/shares/${shareId}`)).status).toBe(200);

    const afterRevoke = await json<DataEnvelope<VehicleRow[]>>(
      await asB('GET', '/api/v1/vehicles?include=shared')
    );
    expect(
      afterRevoke.data.find((v) => v.id === vehicleId),
      'revoked vehicle must disappear from the invitee fleet'
    ).toBeUndefined();
  });

  test('a re-invite after revoke, once accepted, restores the vehicle to the invitee fleet', async () => {
    const [vehicleId, shareId] = await shareWithB('viewer');
    await asB('POST', `/api/v1/shares/${shareId}/accept`);
    await ctx.authed('DELETE', `/api/v1/shares/${shareId}`);

    const reinvite = await ctx.authed('POST', '/api/v1/shares', {
      vehicleId,
      email: bEmail,
      level: 'editor',
    });
    const reBody = await json<DataEnvelope<{ id: string }>>(reinvite);
    expect(reinvite.status, JSON.stringify(reBody)).toBe(201);
    expect((await asB('POST', `/api/v1/shares/${reBody.data.id}/accept`)).status).toBe(200);

    const back = await json<DataEnvelope<VehicleRow[]>>(
      await asB('GET', '/api/v1/vehicles?include=shared')
    );
    const row = back.data.find((v) => v.id === vehicleId);
    expect(row, 'the re-accepted vehicle returns to the invitee fleet').toBeDefined();
    expect(row?.sharedAccess?.level).toBe('editor');
  });
});

describe('GET /vehicles/:id: shared read with level annotation', () => {
  test('an accepted VIEWER loads the shared vehicle, annotated sharedAccess.level=viewer', async () => {
    const [vehicleId, shareId] = await shareWithB('viewer');
    expect((await asB('POST', `/api/v1/shares/${shareId}/accept`)).status).toBe(200);

    const res = await asB('GET', `/api/v1/vehicles/${vehicleId}`);
    const body = await json<DataEnvelope<VehicleRow>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.id).toBe(vehicleId);
    expect(body.data.sharedAccess?.level).toBe('viewer');
    expect(body.data.sharedAccess?.sharedBy).toBe(ctx.user.displayName);
  });

  test('an accepted EDITOR loads it annotated sharedAccess.level=editor', async () => {
    const [vehicleId, shareId] = await shareWithB('editor');
    expect((await asB('POST', `/api/v1/shares/${shareId}/accept`)).status).toBe(200);
    const body = await json<DataEnvelope<VehicleRow>>(
      await asB('GET', `/api/v1/vehicles/${vehicleId}`)
    );
    expect(body.data.sharedAccess?.level).toBe('editor');
  });

  test('the owner response carries no sharedAccess annotation', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Owned', model: 'Car', year: 2021 });
    const body = await json<DataEnvelope<VehicleRow>>(
      await ctx.authed('GET', `/api/v1/vehicles/${vehicleId}`)
    );
    expect(body.data.id).toBe(vehicleId);
    expect(body.data.sharedAccess).toBeUndefined();
  });

  test('a stranger and a pending invitee both get 404', async () => {
    const [pendingVehicle] = await shareWithB('viewer');
    expect((await asB('GET', `/api/v1/vehicles/${pendingVehicle}`)).status).toBe(404);

    const privateVehicle = await seedVehicle(ctx, { make: 'Private', model: 'Car', year: 2021 });
    expect((await asB('GET', `/api/v1/vehicles/${privateVehicle}`)).status).toBe(404);
  });
});

interface StatsEnvelope {
  fuelExpenseCount: number;
  currentOdometer: number | null;
}

describe('GET /vehicles/:id/stats: shared read', () => {
  test('an accepted viewer reads stats from the owner’s books', async () => {
    const [vehicleId, shareId] = await shareWithB('viewer');
    expect((await asB('POST', `/api/v1/shares/${shareId}/accept`)).status).toBe(200);
    await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'fuel',
      expenseAmount: 50,
      volume: 10,
      mileage: 30000,
      fuelType: 'Regular',
      date: '2024-06-01T00:00:00.000Z',
    });

    const res = await asB('GET', `/api/v1/vehicles/${vehicleId}/stats?period=all`);
    const body = await json<DataEnvelope<StatsEnvelope>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.fuelExpenseCount).toBe(1);
    expect(body.data.currentOdometer).toBe(30000);
  });

  test('an accepted editor also reads the shared vehicle stats', async () => {
    const [vehicleId, shareId] = await shareWithB('editor');
    expect((await asB('POST', `/api/v1/shares/${shareId}/accept`)).status).toBe(200);
    expect((await asB('GET', `/api/v1/vehicles/${vehicleId}/stats?period=all`)).status).toBe(200);
  });

  test('a stranger and a pending invitee both get 404', async () => {
    const [pendingVehicle] = await shareWithB('viewer');
    expect((await asB('GET', `/api/v1/vehicles/${pendingVehicle}/stats?period=all`)).status).toBe(
      404
    );
    const privateVehicle = await seedVehicle(ctx, { make: 'Private', model: 'Car', year: 2021 });
    expect((await asB('GET', `/api/v1/vehicles/${privateVehicle}/stats?period=all`)).status).toBe(
      404
    );
  });

  test('the owner can read stats for their own vehicle', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Owned', model: 'Car', year: 2021 });
    expect((await ctx.authed('GET', `/api/v1/vehicles/${vehicleId}/stats?period=all`)).status).toBe(
      200
    );
  });
});
