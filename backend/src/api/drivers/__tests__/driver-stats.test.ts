import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  type TestApp,
} from '../../../test-helpers/http-client';
import { type Members, seedCar, seedMembers } from '../../../test-helpers/members';

let ctx: TestApp;
let m: Members;
const CAR = 'ds-car';
const PERIOD = 'from=2024-02-28T00:00:00.000Z&to=2024-03-10T00:00:00.000Z';
const stats = `/api/v1/vehicles/${CAR}/drivers/stats?${PERIOD}`;

interface Figures {
  driverId: string;
  you: boolean;
  distance: { trips: number; estimated: number; total: number };
  share: number | null;
  fuelBought: number;
  fuelUsed: number | null;
  runningCostsPaid: number;
}

interface Stats {
  scope: 'everyone' | 'own';
  distance: { total: number; attributed: number; unattributed: number | null };
  runningCosts: number | null;
  costPerDistance: number | null;
  drivers: Figures[];
}

async function read(request: RequestFn, path = stats): Promise<Stats> {
  const res = await request('GET', path);
  expect(res.status).toBe(200);
  return (await json<DataEnvelope<Stats>>(res)).data;
}

async function driverOf(userId: string): Promise<string> {
  const res = await ctx.authed('GET', `/api/v1/vehicles/${CAR}/drivers`);
  const list = (await json<DataEnvelope<{ id: string; userId: string | null }[]>>(res)).data;
  return list.find((d) => d.userId === userId)?.id ?? '';
}

beforeEach(async () => {
  ctx = await createTestApp();
  seedCar(ctx, CAR);
  m = await seedMembers(ctx, CAR, 'ds');
  await ctx.authed('PUT', `/api/v1/vehicles/${CAR}/car-share`, { enabled: true });
  await ctx.authed('POST', `/api/v1/odometer/${CAR}`, { odometer: 1000, recordedAt: '2024-03-01' });
  await m.editor.request('POST', '/api/v1/trips', {
    vehicleId: CAR,
    startOdometer: 1000,
    endOdometer: 1100,
    purpose: 'personal',
    tripDate: '2024-03-02',
  });
  await ctx.authed('POST', `/api/v1/odometer/${CAR}`, { odometer: 1300, recordedAt: '2024-03-03' });
  const fillUp = await m.editor.request('POST', '/api/v1/expenses', {
    vehicleId: CAR,
    category: 'fuel',
    date: '2024-03-04',
    expenseAmount: 40,
    volume: 10,
    mileage: 1350,
  });
  expect(fillUp.status).toBe(201);
  await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId: CAR,
    category: 'maintenance',
    date: '2024-03-04',
    expenseAmount: 60,
  });
}, 20_000);
afterEach(() => ctx.close());

describe('per-driver figures', () => {
  test('a manager sees every driver: trips, estimated gaps (a fill-up closes one for its payer), fuel and costs', async () => {
    const data = await read(ctx.authed);
    const byId = new Map(data.drivers.map((d) => [d.driverId, d]));
    const mine = byId.get(await driverOf(ctx.user.id));
    const editor = byId.get(await driverOf(m.editor.id));

    expect(data.scope).toBe('everyone');
    expect(data.distance).toEqual({ total: 350, attributed: 350, unattributed: 0 });
    expect(mine).toMatchObject({
      you: true,
      distance: { trips: 0, estimated: 200, total: 200 },
      share: 0.5714,
      fuelBought: 0,
      fuelUsed: 5.71,
      runningCostsPaid: 60,
    });
    expect(editor).toMatchObject({
      you: false,
      distance: { trips: 100, estimated: 50, total: 150 },
      share: 0.4286,
      fuelBought: 10,
      fuelUsed: 4.29,
      runningCostsPaid: 40,
    });
    expect(data.runningCosts).toBe(100);
    expect(data.costPerDistance).toBe(0.2857);
  });

  test('without estimates only trips count', async () => {
    const data = await read(ctx.authed, `${stats}&estimates=false`);
    expect(data.distance.total).toBe(100);
    expect(data.drivers.every((d) => d.distance.estimated === 0)).toBe(true);
  });

  test('editors and viewers see only their own figures and no unattributed distance', async () => {
    for (const member of [m.editor, m.viewer]) {
      const data = await read(member.request);
      expect(data.scope).toBe('own');
      expect(data.distance.unattributed).toBeNull();
      expect(data.drivers.map((d) => d.driverId)).toEqual([await driverOf(member.id)]);
    }
    expect((await read(m.editor.request)).drivers[0]?.distance.total).toBe(150);
  });

  test('strangers, cars without sharing and backwards periods are refused', async () => {
    expect((await m.stranger.request('GET', stats)).status).toBe(404);
    const backwards = `/api/v1/vehicles/${CAR}/drivers/stats?from=2024-03-10T00:00:00.000Z&to=2024-03-01T00:00:00.000Z`;
    expect((await ctx.authed('GET', backwards)).status).toBe(400);
    await ctx.authed('PUT', `/api/v1/vehicles/${CAR}/car-share`, { enabled: false });
    expect((await ctx.authed('GET', stats)).status).toBe(404);
  });
});
