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

interface VehicleStat {
  vehicleId: string;
  totalAmount: number;
  recentAmount: number;
  lastExpenseDate: string | null;
}

async function createExpense(
  vehicleId: string,
  amount: number,
  date: string,
  category = 'maintenance'
): Promise<void> {
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category,
    expenseAmount: amount,
    date,
    description: 'stat fixture',
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
}

async function getStats(query = ''): Promise<VehicleStat[]> {
  const res = await ctx.authed('GET', `/api/v1/expenses/vehicle-stats${query}`);
  const body = await json<DataEnvelope<VehicleStat[]>>(res);
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body.data;
}

function isoDaysAgo(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

describe('GET /api/v1/expenses/vehicle-stats (per-vehicle stats route)', () => {
  test('totals + counts are grouped per vehicle (no cross-vehicle bleed)', async () => {
    const v1 = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const v2 = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    await createExpense(v1, 100, isoDaysAgo(60));
    await createExpense(v1, 50, isoDaysAgo(50));
    await createExpense(v2, 25, isoDaysAgo(40));

    const stats = await getStats();
    const s1 = stats.find((s) => s.vehicleId === v1);
    const s2 = stats.find((s) => s.vehicleId === v2);
    expect(s1?.totalAmount).toBeCloseTo(150, 5);
    expect(s2?.totalAmount).toBeCloseTo(25, 5);
  });

  test('recentAmount counts only the trailing 30-day window; totalAmount counts all', async () => {
    const v1 = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await createExpense(v1, 200, isoDaysAgo(60));
    await createExpense(v1, 30, isoDaysAgo(5));

    const stats = await getStats();
    const s1 = stats.find((s) => s.vehicleId === v1);
    expect(s1?.totalAmount).toBeCloseTo(230, 5);
    expect(s1?.recentAmount).toBeCloseTo(30, 5);
  });

  test('a custom recentDays widens the recent window', async () => {
    const v1 = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await createExpense(v1, 200, isoDaysAgo(60));
    await createExpense(v1, 30, isoDaysAgo(45));

    const def = await getStats();
    expect(def.find((s) => s.vehicleId === v1)?.recentAmount).toBeCloseTo(0, 5);
    const wide = await getStats('?recentDays=90');
    expect(wide.find((s) => s.vehicleId === v1)?.recentAmount).toBeCloseTo(230, 5);
  });

  test('lastExpenseDate is the most-recent expense date for the vehicle', async () => {
    const v1 = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await createExpense(v1, 10, '2024-03-01T12:00:00.000Z');
    await createExpense(v1, 20, '2024-06-15T12:00:00.000Z');
    await createExpense(v1, 15, '2024-05-10T12:00:00.000Z');

    const stats = await getStats();
    const s1 = stats.find((s) => s.vehicleId === v1);
    expect(s1?.lastExpenseDate).toContain('2024-06-15');
  });

  test('is userId-scoped — a foreign user’s vehicle never appears', async () => {
    const v1 = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await createExpense(v1, 100, isoDaysAgo(10));
    const stats = await getStats();
    expect(stats.every((s) => s.vehicleId === v1)).toBe(true);
    expect(stats).toHaveLength(1);
  });
});

describe('GET /api/v1/expenses/vehicle-stats for shared vehicles', () => {
  async function share(vehicleId: string, level: 'editor' | 'viewer', accept: boolean) {
    const invitee = await createInvitee(ctx, `stats-${level}-${accept}`, `Stats ${level}`);
    const res = await ctx.authed('POST', '/api/v1/shares', {
      vehicleId,
      email: invitee.email,
      level,
    });
    const created = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(created)).toBe(201);
    if (accept) {
      const accepted = await invitee.request('POST', `/api/v1/shares/${created.data.id}/accept`);
      expect(accepted.status).toBe(200);
    }
    return invitee;
  }

  async function statsFor(request: (method: string, path: string) => Promise<Response>) {
    const res = await request('GET', '/api/v1/expenses/vehicle-stats');
    expect(res.status).toBe(200);
    return (await json<DataEnvelope<VehicleStat[]>>(res)).data;
  }

  test("an editor and a viewer see the owner's numbers; a stranger and a pending invitee see none", async () => {
    const shared = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const unshared = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    await createExpense(shared, 120, isoDaysAgo(60));
    await createExpense(shared, 40, isoDaysAgo(3));
    await createExpense(unshared, 75, isoDaysAgo(2));
    const editor = await share(shared, 'editor', true);
    const viewer = await share(shared, 'viewer', true);
    const pending = await share(shared, 'viewer', false);
    const stranger = await createInvitee(ctx, 'stats-stranger', 'Stranger');

    const owner = (await statsFor(ctx.authed)).find((s) => s.vehicleId === shared);
    expect(owner).toMatchObject({ totalAmount: 160, recentAmount: 40 });
    expect(owner?.lastExpenseDate).not.toBeNull();

    for (const guest of [editor, viewer]) {
      expect(await statsFor(guest.request)).toEqual([owner as VehicleStat]);
    }
    expect(await statsFor(pending.request)).toEqual([]);
    expect(await statsFor(stranger.request)).toEqual([]);
  });

  test("an expense an editor logs counts toward the owner's card too", async () => {
    const shared = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const editor = await share(shared, 'editor', true);
    const res = await editor.request('POST', '/api/v1/expenses', {
      vehicleId: shared,
      category: 'maintenance',
      expenseAmount: 55,
      date: isoDaysAgo(1),
    });
    expect(res.status).toBe(201);

    const owner = (await statsFor(ctx.authed)).find((s) => s.vehicleId === shared);
    expect(owner?.totalAmount).toBeCloseTo(55, 5);
    expect((await statsFor(editor.request))[0]?.totalAmount).toBeCloseTo(55, 5);
  });
});
