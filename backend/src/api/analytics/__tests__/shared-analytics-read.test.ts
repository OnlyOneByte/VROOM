import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;
let bCookie: string;
let bEmail: string;
let bCounter = 0;

const RANGE = 'startDate=1704067200&endDate=1735689600';

beforeEach(async () => {
  ctx = await createTestApp();
  const { db } = await import('../../../db/connection');
  const schema = await import('../../../db/schema');
  const { lucia } = await import('../../auth/lucia');
  const bId = `an-invitee-${++bCounter}`;
  bEmail = `an-invitee-${bCounter}@test.com`;
  await db.insert(schema.users).values({ id: bId, email: bEmail, displayName: 'Analytics B' });
  const session = await lucia.createSession(bId, {});
  const sc = lucia.createSessionCookie(session.id);
  bCookie = `${sc.name}=${sc.value}`;
});
afterEach(() => ctx.close());

async function asB(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Cookie: bCookie, 'Sec-Fetch-Site': 'same-origin' };
  let init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init = { ...init, body: JSON.stringify(body) };
  }
  return ctx.app.request(path, init);
}

async function shareWithFuel(level: 'viewer' | 'editor'): Promise<string> {
  const vehicleId = await seedVehicle(ctx, { make: 'Shared', model: 'Car', year: 2021 });
  const exp = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'fuel',
    expenseAmount: 50,
    volume: 10,
    mileage: 30000,
    fuelType: 'Regular',
    date: '2024-06-01T00:00:00.000Z',
  });
  expect((await json<DataEnvelope<{ id: string }>>(exp)).data).toBeDefined();
  const invite = await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: bEmail, level });
  const inviteId = (await json<DataEnvelope<{ id: string }>>(invite)).data.id;
  expect((await asB('POST', `/api/v1/shares/${inviteId}/accept`)).status).toBe(200);
  return vehicleId;
}

function vehicleRoutes(vehicleId: string): string[] {
  return [
    `/api/v1/analytics/fuel-stats?${RANGE}&vehicleId=${vehicleId}`,
    `/api/v1/analytics/fuel-advanced?${RANGE}&vehicleId=${vehicleId}`,
    `/api/v1/analytics/fuel-efficiency?vehicleId=${vehicleId}`,
    `/api/v1/analytics/vehicle-health?vehicleId=${vehicleId}`,
    `/api/v1/analytics/vehicle-tco?vehicleId=${vehicleId}`,
    `/api/v1/analytics/vehicle-expenses?${RANGE}&vehicleId=${vehicleId}`,
  ];
}

describe('analytics per-vehicle reads for shared vehicles', () => {
  test('an accepted VIEWER reads all six per-vehicle analytics routes for the shared vehicle', async () => {
    const vehicleId = await shareWithFuel('viewer');
    for (const route of vehicleRoutes(vehicleId)) {
      const res = await asB('GET', route);
      expect(res.status, `viewer GET ${route}`).toBe(200);
    }
  });

  test('an accepted EDITOR likewise reads all six', async () => {
    const vehicleId = await shareWithFuel('editor');
    for (const route of vehicleRoutes(vehicleId)) {
      expect((await asB('GET', route)).status, `editor GET ${route}`).toBe(200);
    }
  });

  test('a STRANGER (no share) is denied all six with the existence-hiding 404', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Private', model: 'Car', year: 2021 });
    await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'fuel',
      expenseAmount: 40,
      volume: 8,
      mileage: 20000,
      fuelType: 'Regular',
      date: '2024-06-02T00:00:00.000Z',
    });
    for (const route of vehicleRoutes(vehicleId)) {
      expect((await asB('GET', route)).status, `stranger GET ${route}`).toBe(404);
    }
  });

  test('a PENDING (un-accepted) invite grants no analytics read (still 404)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Pending', model: 'Car', year: 2021 });
    await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: bEmail, level: 'viewer' });
    for (const route of vehicleRoutes(vehicleId)) {
      expect((await asB('GET', route)).status, `pending GET ${route}`).toBe(404);
    }
  });

  test('the per-vehicle TCO surfaces the OWNER-stamped expense to the viewer (owner-scope, not empty)', async () => {
    const vehicleId = await shareWithFuel('viewer');
    const res = await asB('GET', `/api/v1/analytics/vehicle-tco?vehicleId=${vehicleId}`);
    const body = await json<DataEnvelope<{ totalCost: number }>>(res);
    expect(res.status).toBe(200);
    expect(body.data.totalCost).toBeGreaterThan(0);
  });

  test('the owner reading their OWN vehicle analytics is unchanged (owner === acting)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Owned', model: 'Car', year: 2022 });
    await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'fuel',
      expenseAmount: 25,
      volume: 5,
      mileage: 15000,
      fuelType: 'Regular',
      date: '2024-06-03T00:00:00.000Z',
    });
    expect(
      (await ctx.authed('GET', `/api/v1/analytics/vehicle-tco?vehicleId=${vehicleId}`)).status
    ).toBe(200);
  });
});
