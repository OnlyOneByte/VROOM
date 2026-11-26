import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { type Members, overrideOn, seedCar, seedMembers } from '../../../test-helpers/members';

let ctx: TestApp;
let m: Members;
const CAR = 've-car';
const car = `/api/v1/vehicles/${CAR}`;

beforeEach(async () => {
  ctx = await createTestApp();
  seedCar(ctx, CAR);
  m = await seedMembers(ctx, CAR, 've');
  ctx.sqlite.run(
    "INSERT INTO vehicle_financing (id, vehicle_id, provider, original_amount, term_months, start_date, payment_amount) VALUES ('ve-loan', ?, 'Bank', 1000000, 60, 1704067200, 20000)",
    [CAR]
  );
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

const status = (request: RequestFn, method: string, path: string, body?: unknown) =>
  request(method, path, body).then((res) => res.status);

interface ListedVehicle {
  id: string;
  financing?: unknown;
}

async function sharedList(request: RequestFn): Promise<ListedVehicle[]> {
  const res = await request('GET', '/api/v1/vehicles?include=shared');
  expect(res.status).toBe(200);
  return (await json<DataEnvelope<ListedVehicle[]>>(res)).data;
}

describe('vehicles resolve through can() for every role', () => {
  test('a co-owner edits the car; editors and viewers cannot; only the owner deletes it', async () => {
    expect(await status(m.coOwner.request, 'PUT', car, { nickname: 'Ours' })).toBe(200);
    expect(await status(m.editor.request, 'PUT', car, { nickname: 'Mine' })).toBe(403);
    expect(await status(m.viewer.request, 'PUT', car, { nickname: 'Mine' })).toBe(403);
    expect(await status(m.disabled.request, 'PUT', car, { nickname: 'Mine' })).toBe(403);
    expect(await status(m.stranger.request, 'PUT', car, { nickname: 'Mine' })).toBe(404);
    overrideOn(ctx, CAR, m.coOwner, 'vehicle.write', 'deny');
    expect(await status(m.coOwner.request, 'PUT', car, { nickname: 'Ours' })).toBe(403);
    expect(await status(m.coOwner.request, 'DELETE', car)).toBe(403);
    expect(await status(ctx.authed, 'DELETE', car)).toBe(200);
  });

  test("a co-owner's plate change is checked against the owner's other cars", async () => {
    ctx.sqlite.run(
      "INSERT INTO vehicles (id, user_id, make, model, year, license_plate) VALUES ('ve-second', ?, 'Honda', 'Fit', 2020, 'ABC123')",
      [ctx.user.id]
    );
    expect(await status(m.coOwner.request, 'PUT', car, { licensePlate: 'ABC123' })).toBe(409);
  });

  test('car stats follow expense read', async () => {
    expect(await status(m.viewer.request, 'GET', `${car}/stats`)).toBe(200);
    overrideOn(ctx, CAR, m.viewer, 'vehicle.expense.read', 'deny');
    expect(await status(m.viewer.request, 'GET', `${car}/stats`)).toBe(403);
    expect(await status(m.viewer.request, 'GET', car)).toBe(200);
  });

  test('the shared list follows vehicle read and shows loans only to financial readers', async () => {
    expect((await sharedList(m.coOwner.request)).find((v) => v.id === CAR)?.financing).toBeTruthy();
    expect((await sharedList(m.viewer.request)).find((v) => v.id === CAR)?.financing).toBeFalsy();
    overrideOn(ctx, CAR, m.viewer, 'vehicle.read', 'deny');
    expect((await sharedList(m.viewer.request)).map((v) => v.id)).not.toContain(CAR);
    expect(await status(m.viewer.request, 'GET', car)).toBe(403);
  });

  test('an edit never returns or changes what the editor cannot see', async () => {
    ctx.sqlite.run("UPDATE vehicles SET vin = 'VIN123', purchase_price = 2000000 WHERE id = ?", [
      CAR,
    ]);
    overrideOn(ctx, CAR, m.coOwner, 'vehicle.financing.read', 'deny');
    const res = await m.coOwner.request('PUT', car, { nickname: 'Ours' });
    expect(res.status).toBe(200);
    const body = (await json<DataEnvelope<Record<string, unknown>>>(res)).data;
    expect(body.vin).toBeNull();
    expect(body.purchasePrice).toBeNull();
    expect(body.userId).toBeUndefined();
    expect(await status(m.coOwner.request, 'PUT', car, { purchasePrice: 1 })).toBe(403);
    expect(await status(m.coOwner.request, 'PUT', car, { vin: '1HGCM82633A004352' })).toBe(403);

    overrideOn(ctx, CAR, m.viewer, 'vehicle.write', 'allow');
    const edited = await m.viewer.request('PUT', car, {});
    expect(edited.status).toBe(200);
    expect((await json<DataEnvelope<Record<string, unknown>>>(edited)).data.vin).toBeNull();
  });

  test('allow overrides on both financial reads show the loan in the shared list', async () => {
    overrideOn(ctx, CAR, m.viewer, 'vehicle.financing.read', 'allow');
    overrideOn(ctx, CAR, m.viewer, 'vehicle.insurance.read', 'allow');
    expect((await sharedList(m.viewer.request)).find((v) => v.id === CAR)?.financing).toBeTruthy();
  });

  test('a disabled account cannot list or add vehicles', async () => {
    expect(await status(m.disabled.request, 'GET', '/api/v1/vehicles')).toBe(403);
    const body = { make: 'Ford', model: 'Focus', year: 2019 };
    expect(await status(m.disabled.request, 'POST', '/api/v1/vehicles', body)).toBe(403);
  });
});
