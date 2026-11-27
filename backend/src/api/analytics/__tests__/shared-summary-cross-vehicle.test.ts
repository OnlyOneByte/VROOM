import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee, type Invitee } from '../../../test-helpers/invitee';
import { overrideOn, seedCar, shareCar } from '../../../test-helpers/members';

let ctx: TestApp;
let viewer: Invitee;
let stranger: Invitee;

const SHARED = 'ssc-shared';
const PRIVATE = 'ssc-private';
const JUNE = 1717200000;
const RANGE = 'startDate=1704067200&endDate=1735689600';

interface Cross {
  vehicleCostComparison: Array<{ vehicleId: string; totalCost: number }>;
  expenseByCategory: Array<{ category: string; amount: number }>;
}

interface Summary {
  quickStats: { vehicleCount: number; ytdSpending: number };
}

function expense(vehicleId: string, category: string, cents: number, source: string | null = null) {
  ctx.sqlite.run(
    'INSERT INTO expenses (id, vehicle_id, user_id, category, expense_amount, date, source_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [`ssc-${vehicleId}-${category}-${cents}`, vehicleId, ctx.user.id, category, cents, JUNE, source]
  );
}

beforeEach(async () => {
  ctx = await createTestApp();
  seedCar(ctx, SHARED);
  seedCar(ctx, PRIVATE);
  expense(SHARED, 'maintenance', 8000);
  expense(SHARED, 'financial', 5000);
  expense(SHARED, 'financial', 40000, 'financing');
  expense(PRIVATE, 'maintenance', 70000);
  viewer = await createInvitee(ctx, 'ssc-viewer');
  stranger = await createInvitee(ctx, 'ssc-stranger');
  shareCar(ctx, SHARED, viewer, 'viewer');
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function cross(request: RequestFn, extra = ''): Promise<Cross> {
  const res = await request('GET', `/api/v1/analytics/cross-vehicle?${RANGE}${extra}`);
  expect(res.status).toBe(200);
  return (await json<DataEnvelope<Cross>>(res)).data;
}

async function summary(request: RequestFn, extra = ''): Promise<Summary> {
  const res = await request('GET', `/api/v1/analytics/summary?${RANGE}${extra}`);
  expect(res.status).toBe(200);
  return (await json<DataEnvelope<Summary>>(res)).data;
}

const costs = (data: Cross) =>
  Object.fromEntries(data.vehicleCostComparison.map((v) => [v.vehicleId, v.totalCost]));

describe('summary and Cross-vehicle cover cars shared with you, as each share allows', () => {
  test('a viewer without financial access gets the shared car without its financial rows', async () => {
    for (const scope of ['', `&vehicleIds=${SHARED}`]) {
      const data = await cross(viewer.request, scope);
      expect(costs(data), scope).toEqual({ [SHARED]: 80 });
      expect(
        data.expenseByCategory.map((c) => c.category),
        scope
      ).toEqual(['maintenance']);
      expect((await summary(viewer.request, scope)).quickStats.vehicleCount, scope).toBe(1);
    }
  });

  test('a viewer the owner lets see financials gets them too', async () => {
    overrideOn(ctx, SHARED, viewer, 'vehicle.financing.read', 'allow');
    overrideOn(ctx, SHARED, viewer, 'vehicle.insurance.read', 'allow');
    expect(costs(await cross(viewer.request))).toEqual({ [SHARED]: 80 + 50 + 400 });
  });

  test("the owner's car that is not shared never appears, even when asked for", async () => {
    const data = await cross(viewer.request, `&vehicleIds=${SHARED},${PRIVATE}`);
    expect(Object.keys(costs(data))).toEqual([SHARED]);
    const one = await summary(viewer.request, `&vehicleIds=${PRIVATE}`);
    expect(one.quickStats.vehicleCount).toBe(0);
  });

  test('someone the car is not shared with, or denied expense reads on it, gets nothing', async () => {
    expect(costs(await cross(stranger.request, `&vehicleIds=${SHARED}`))).toEqual({});
    overrideOn(ctx, SHARED, viewer, 'vehicle.expense.read', 'deny');
    expect(costs(await cross(viewer.request))).toEqual({});
    expect((await summary(viewer.request)).quickStats.vehicleCount).toBe(0);
  });

  test('a shared car kept in another currency is left out', async () => {
    ctx.sqlite.run(
      "INSERT INTO user_preferences (user_id, currency_unit) VALUES (?, 'EUR') ON CONFLICT(user_id) DO UPDATE SET currency_unit = 'EUR'",
      [ctx.user.id]
    );
    expect(costs(await cross(viewer.request))).toEqual({});

    for (const path of [
      `/api/v1/analytics/summary?${RANGE}`,
      `/api/v1/analytics/cross-vehicle?${RANGE}`,
      '/api/v1/analytics/financing',
      '/api/v1/analytics/insurance',
    ]) {
      const res = await viewer.request('GET', path);
      const body = await json<DataEnvelope<{ coverage: { otherCurrency: unknown[] } }>>(res);
      expect(body.data.coverage.otherCurrency, path).toEqual([
        { vehicleId: SHARED, currency: 'EUR' },
      ]);
    }
  });

  test("the summary's spending leaves out what the share hides", async () => {
    const data = await summary(viewer.request, '&ytdStart=1704067200');
    expect(data.quickStats.ytdSpending).toBe(80);
  });

  test('an empty car list means no cars, as before', async () => {
    expect(costs(await cross(ctx.authed, '&vehicleIds='))).toEqual({});
  });

  test("the owner's view is unchanged", async () => {
    const data = await cross(ctx.authed);
    expect(costs(data)).toEqual({ [SHARED]: 80 + 50 + 400, [PRIVATE]: 700 });
    expect((await summary(ctx.authed)).quickStats.vehicleCount).toBe(2);
  });
});

describe('financing and insurance cover shared cars only where the share shows them', () => {
  interface Financing {
    vehicleDetails: Array<{ vehicleId: string }>;
  }
  interface Insurance {
    summary: { totalAnnualPremiums: number };
    vehicleDetails: Array<{ vehicleId: string }>;
  }

  beforeEach(async () => {
    const loan = await ctx.authed('POST', `/api/v1/financing/vehicles/${SHARED}/financing`, {
      financingType: 'loan',
      provider: 'Lender',
      originalAmount: 20000,
      termMonths: 60,
      startDate: '2024-01-01T00:00:00.000Z',
      paymentAmount: 400,
      apr: 5,
    });
    expect(loan.status).toBeLessThan(300);
    const policy = await ctx.authed('POST', '/api/v1/insurance', {
      company: 'Mutual',
      terms: [
        {
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2027-01-01T00:00:00.000Z',
          totalCost: 2400,
          vehicleCoverage: { vehicleIds: [SHARED, PRIVATE] },
        },
      ],
    });
    expect(policy.status).toBeLessThan(300);
  });

  async function financing(request: RequestFn): Promise<Financing> {
    const res = await request('GET', '/api/v1/analytics/financing');
    expect(res.status).toBe(200);
    return (await json<DataEnvelope<Financing>>(res)).data;
  }

  async function insurance(request: RequestFn): Promise<Insurance> {
    const res = await request('GET', '/api/v1/analytics/insurance');
    expect(res.status).toBe(200);
    return (await json<DataEnvelope<Insurance>>(res)).data;
  }

  test('a viewer without financial access gets no financing or insurance for the shared car', async () => {
    expect((await financing(viewer.request)).vehicleDetails).toEqual([]);
    for (const path of ['/api/v1/analytics/financing', '/api/v1/analytics/insurance']) {
      const res = await viewer.request('GET', path);
      const body = await json<DataEnvelope<{ coverage: { vehicleIds: string[] } }>>(res);
      expect(body.data.coverage.vehicleIds, path).toEqual([]);
    }
    const data = await insurance(viewer.request);
    expect(data.vehicleDetails).toEqual([]);
    expect(data.summary.totalAnnualPremiums).toBe(0);
  });

  test("a viewer with financial access gets the shared car's share and nothing of the owner's other car", async () => {
    overrideOn(ctx, SHARED, viewer, 'vehicle.financing.read', 'allow');
    overrideOn(ctx, SHARED, viewer, 'vehicle.insurance.read', 'allow');
    expect((await financing(viewer.request)).vehicleDetails.map((d) => d.vehicleId)).toEqual([
      SHARED,
    ]);
    const data = await insurance(viewer.request);
    expect(data.vehicleDetails.map((d) => d.vehicleId)).toEqual([SHARED]);
    expect(data.summary.totalAnnualPremiums).toBeCloseTo(1200);
  });

  test("cars shared by two owners merge each owner's share of their own policies", async () => {
    const other = await createInvitee(ctx, 'ssc-owner2');
    seedCar(ctx, 'ssc-other', other.id);
    shareCar(ctx, 'ssc-other', viewer, 'viewer');
    const policy = await other.request('POST', '/api/v1/insurance', {
      company: 'Mutual',
      terms: [
        {
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2027-01-01T00:00:00.000Z',
          totalCost: 600,
          vehicleCoverage: { vehicleIds: ['ssc-other'] },
        },
      ],
    });
    expect(policy.status).toBeLessThan(300);
    for (const car of [SHARED, 'ssc-other']) {
      for (const permission of ['vehicle.financing.read', 'vehicle.insurance.read']) {
        ctx.sqlite.run(
          "INSERT INTO permission_overrides (id, user_id, scope, scope_id, permission, effect) VALUES (?, ?, 'vehicle', ?, ?, 'allow')",
          [`ssc-po-${car}-${permission}`, viewer.id, car, permission]
        );
      }
    }

    const data = await insurance(viewer.request);
    expect(data.vehicleDetails.map((d) => d.vehicleId).sort()).toEqual(
      ['ssc-other', SHARED].sort()
    );
    expect(data.summary.totalAnnualPremiums).toBeCloseTo(1200 + 600);
  });

  test("the owner's financing and insurance are unchanged", async () => {
    const own = (await financing(ctx.authed)).vehicleDetails.map((d) => d.vehicleId);
    expect(own.sort()).toEqual([PRIVATE, SHARED].sort());
    const data = await insurance(ctx.authed);
    expect(data.vehicleDetails.map((d) => d.vehicleId).sort()).toEqual([PRIVATE, SHARED].sort());
    expect(data.summary.totalAnnualPremiums).toBeCloseTo(2400);
  });

  test("an owner's policy whose cars were all removed from it still counts, as before", async () => {
    ctx.sqlite.run('DELETE FROM insurance_term_vehicles');
    const data = await insurance(ctx.authed);
    expect(data.summary.totalAnnualPremiums).toBeCloseTo(2400);
  });
});
