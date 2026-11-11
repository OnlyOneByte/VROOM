/**
 * The assistant's read-tool layer and the HTTP API answer the same questions over the same rows, so
 * they MUST report the same money. Money is stored and computed in integer CENTS; dollars exist only at
 * the display edge, and the tool layer is a second consumer of that edge — one the model cannot
 * sanity-check, because its system prompt states the amounts are already in the user's currency. A tool
 * that hands back raw cents therefore makes the assistant read every figure out 100x too large.
 *
 * Each test pins one tool against the route that answers the same question over the SAME seeded data.
 * That is the assertion that cannot drift: the route is the dollar contract the frontend already
 * consumes, so it is the oracle rather than a second hand-written expectation.
 *
 * The scope half is pinned the same way. A shared vehicle's rows are OWNER-stamped, so a sharee's
 * per-vehicle question has to resolve to the owner's books exactly as the route does, or the assistant
 * reports zeros for data the API shows them.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../../../test-helpers/http-client';
import { seedVehicle } from '../../../../../test-helpers/seed';

let ctx: TestApp;

// Dynamically imported AFTER createTestApp so the repos the tools wrap bind the test DB singleton.
type ToolsModule = typeof import('../tools');
let tools: ToolsModule;

// Seeded DOLLAR amounts — what both surfaces must report (the cents bug reports each one 100x larger).
const PURCHASE_PRICE = 20_000;
const FUEL_ONE = 50.25;
const FUEL_TWO = 60.5;
const MAINTENANCE = 250;
const LOAN_ORIGINAL = 18_000;
const LOAN_PAYMENT = 350.75;
const INSURANCE_TOTAL = 1200.5;
const INSURANCE_MONTHLY = 100.25;
const INSURANCE_DEDUCTIBLE = 500;
const REMINDER_AMOUNT = 75.5;

// Creating the insurance term auto-materializes its premium as a dated expense, so the all-time books
// carry it alongside the three seeded rows. It falls OUTSIDE the 30-day analytics window.
const WINDOW_EXPENSES = FUEL_ONE + FUEL_TWO + MAINTENANCE;
const ALL_TIME_EXPENSES = WINDOW_EXPENSES + INSURANCE_TOTAL;
const ALL_TIME_EXPENSE_COUNT = 4;

const nowMs = Date.now();
const ago = (days: number): string => new Date(nowMs - days * 86_400_000).toISOString();
const ahead = (days: number): string => new Date(nowMs + days * 86_400_000).toISOString();

/** The analytics window the tool's `30d` range resolves to, as the route's epoch-seconds query. */
function analyticsRange(): string {
  const { start, end } = tools.resolveRange('30d', nowMs);
  return `startDate=${start}&endDate=${end}`;
}

/** Dates serialize to ISO strings over HTTP; normalize the tool's Date objects the same way. */
function overTheWire<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

let bCookie: string;
let bEmail: string;
let bUserId: string;
let bCounter = 0;

beforeEach(async () => {
  ctx = await createTestApp();
  tools = await import('../tools');
  const { db } = await import('../../../../../db/connection');
  const schema = await import('../../../../../db/schema');
  const { lucia } = await import('../../../../auth/lucia');
  bUserId = `llm-money-invitee-${++bCounter}`;
  bEmail = `llm-money-invitee-${bCounter}@test.com`;
  await db.insert(schema.users).values({ id: bUserId, email: bEmail, displayName: 'Invitee B' });
  const session = await lucia.createSession(bUserId, {});
  const sc = lucia.createSessionCookie(session.id);
  bCookie = `${sc.name}=${sc.value}`;
});
afterEach(() => ctx.close());

/** An authenticated request as the INVITEE (user B), not the harness session user. */
async function asB(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Cookie: bCookie, 'Sec-Fetch-Site': 'same-origin' };
  let init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init = { ...init, body: JSON.stringify(body) };
  }
  return ctx.app.request(path, init);
}

async function expectCreated(res: Response, label: string): Promise<void> {
  const body = await json<unknown>(res);
  expect(res.status, `${label}: ${JSON.stringify(body)}`).toBeLessThan(300);
}

/**
 * One vehicle carrying every money surface the tools expose: purchase price, two fuel fill-ups, a
 * maintenance expense, a loan, an insurance term and an expense reminder (dated ahead so the trigger
 * service does not materialize it mid-test).
 */
async function seedFullFixture(): Promise<string> {
  const vehicleId = await seedVehicle(ctx, {
    extra: { purchasePrice: PURCHASE_PRICE, initialMileage: 30_000, purchaseDate: ago(400) },
  });

  await expectCreated(
    await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'fuel',
      expenseAmount: FUEL_ONE,
      volume: 10,
      mileage: 30_500,
      fuelType: 'Regular',
      date: ago(6),
    }),
    'fuel 1'
  );
  await expectCreated(
    await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'fuel',
      expenseAmount: FUEL_TWO,
      volume: 12,
      mileage: 31_000,
      fuelType: 'Regular',
      date: ago(2),
    }),
    'fuel 2'
  );
  await expectCreated(
    await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'maintenance',
      expenseAmount: MAINTENANCE,
      mileage: 30_800,
      date: ago(4),
    }),
    'maintenance'
  );
  await expectCreated(
    await ctx.authed('POST', `/api/v1/financing/vehicles/${vehicleId}/financing`, {
      financingType: 'loan',
      provider: 'Test Bank',
      originalAmount: LOAN_ORIGINAL,
      termMonths: 60,
      startDate: ago(365),
      paymentAmount: LOAN_PAYMENT,
      paymentFrequency: 'monthly',
      apr: 4.5,
    }),
    'financing'
  );
  await expectCreated(
    await ctx.authed('POST', '/api/v1/insurance', {
      company: 'Test Mutual',
      terms: [
        {
          startDate: ago(180),
          endDate: ahead(180),
          totalCost: INSURANCE_TOTAL,
          monthlyCost: INSURANCE_MONTHLY,
          deductibleAmount: INSURANCE_DEDUCTIBLE,
          vehicleCoverage: { vehicleIds: [vehicleId] },
        },
      ],
    }),
    'insurance'
  );
  await expectCreated(
    await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Oil change',
      type: 'expense',
      frequency: 'monthly',
      startDate: ahead(14),
      vehicleIds: [vehicleId],
      expenseCategory: 'maintenance',
      expenseAmount: REMINDER_AMOUNT,
    }),
    'reminder'
  );

  return vehicleId;
}

/** Run a tool as the session user and return its result as it would reach the model. */
async function runTool<T>(name: string, args: unknown, userId = ctx.user.id): Promise<T> {
  const tool = tools.ASSISTANT_TOOLS[name];
  expect(tool, `tool ${name} must be in the allowlist`).toBeDefined();
  return overTheWire<T>(await tool.run(args, userId, nowMs));
}

/** GET a route as the session user and return its `data` payload. */
async function routeData<T>(path: string): Promise<T> {
  const res = await ctx.authed('GET', path);
  const body = await json<DataEnvelope<T>>(res);
  expect(res.status, `GET ${path}: ${JSON.stringify(body)}`).toBe(200);
  return body.data;
}

interface ApiVehicle {
  id: string;
  purchasePrice: number | null;
  financing?: { originalAmount: number; paymentAmount: number } | null;
}

interface ApiExpenseSummary {
  totalAmount: number;
  expenseCount: number;
  monthlyAverage: number;
  recentAmount: number;
  categoryBreakdown: Array<{ category: string; amount: number }>;
  monthlyTrend: Array<{ period: string; amount: number }>;
}

interface ApiReminder {
  reminder: { id: string; expenseAmount: number | null };
}

describe('assistant tools report the SAME money as the HTTP routes (dollars, not cents)', () => {
  test('listVehicles: purchase price + embedded financing match GET /vehicles', async () => {
    await seedFullFixture();

    const toolRows = await runTool<ApiVehicle[]>('listVehicles', {});
    const routeRows = await routeData<ApiVehicle[]>('/api/v1/vehicles');

    expect(toolRows).toHaveLength(1);
    const toolRow = toolRows[0];
    const routeRow = routeRows.find((v) => v.id === toolRow.id);
    if (!routeRow) throw new Error('GET /vehicles must return the same vehicle the tool listed');

    expect(toolRow.purchasePrice).toBe(PURCHASE_PRICE);
    expect(toolRow.purchasePrice).toBe(routeRow.purchasePrice);
    expect(toolRow.financing?.originalAmount).toBe(LOAN_ORIGINAL);
    expect(toolRow.financing?.originalAmount).toBe(routeRow.financing?.originalAmount);
    expect(toolRow.financing?.paymentAmount).toBe(LOAN_PAYMENT);
    expect(toolRow.financing?.paymentAmount).toBe(routeRow.financing?.paymentAmount);
  });

  test('getExpenseSummary: every money field matches GET /expenses/summary', async () => {
    await seedFullFixture();

    const tool = await runTool<ApiExpenseSummary>('getExpenseSummary', { range: 'all' });
    const route = await routeData<ApiExpenseSummary>('/api/v1/expenses/summary?period=all');

    expect(tool.totalAmount).toBe(ALL_TIME_EXPENSES);
    expect(tool.expenseCount).toBe(ALL_TIME_EXPENSE_COUNT);
    expect(tool.categoryBreakdown.find((r) => r.category === 'fuel')?.amount).toBe(
      FUEL_ONE + FUEL_TWO
    );
    expect(tool).toEqual(route);
  });

  test('getFuelStats: cost fields match GET /analytics/fuel-stats', async () => {
    await seedFullFixture();

    const tool = await runTool<{ averageCost: { perFillup: number | null } }>('getFuelStats', {
      range: '30d',
    });
    const route = await routeData<{ averageCost: { perFillup: number | null } }>(
      `/api/v1/analytics/fuel-stats?${analyticsRange()}`
    );

    expect(tool.averageCost.perFillup).toBeCloseTo((FUEL_ONE + FUEL_TWO) / 2, 2);
    expect(tool).toEqual(route);
  });

  test('getAnalyticsSummary: quick-stats + fuel-stats money match GET /analytics/summary', async () => {
    await seedFullFixture();

    const tool = await runTool<{ quickStats: { ytdSpending: number } }>('getAnalyticsSummary', {
      range: '30d',
    });
    const route = await routeData<{ quickStats: { ytdSpending: number } }>(
      `/api/v1/analytics/summary?${analyticsRange()}`
    );

    expect(tool.quickStats.ytdSpending).toBeCloseTo(WINDOW_EXPENSES, 2);
    expect(tool).toEqual(route);
  });

  test('getCrossVehicle: per-vehicle totals match GET /analytics/cross-vehicle', async () => {
    await seedFullFixture();

    const tool = await runTool<{ vehicleCostComparison: Array<{ totalCost: number }> }>(
      'getCrossVehicle',
      { range: '30d' }
    );
    const route = await routeData<{ vehicleCostComparison: Array<{ totalCost: number }> }>(
      `/api/v1/analytics/cross-vehicle?${analyticsRange()}`
    );

    expect(tool.vehicleCostComparison[0]?.totalCost).toBeCloseTo(WINDOW_EXPENSES, 2);
    expect(tool).toEqual(route);
  });

  test('getFinancingState: balances + payments match GET /analytics/financing', async () => {
    await seedFullFixture();

    const tool = await runTool<{ summary: { totalMonthlyPayments: number } }>(
      'getFinancingState',
      {}
    );
    const route = await routeData<{ summary: { totalMonthlyPayments: number } }>(
      '/api/v1/analytics/financing'
    );

    expect(tool.summary.totalMonthlyPayments).toBeCloseTo(LOAN_PAYMENT, 2);
    expect(tool).toEqual(route);
  });

  test('getInsuranceState: premiums match GET /analytics/insurance', async () => {
    await seedFullFixture();

    const tool = await runTool<{ summary: { totalMonthlyPremiums: number } }>(
      'getInsuranceState',
      {}
    );
    const route = await routeData<{ summary: { totalMonthlyPremiums: number } }>(
      '/api/v1/analytics/insurance'
    );

    expect(tool.summary.totalMonthlyPremiums).toBeCloseTo(INSURANCE_MONTHLY, 2);
    expect(tool).toEqual(route);
  });

  test('getUpcomingReminders: templated expense amount matches GET /reminders', async () => {
    await seedFullFixture();

    const tool = await runTool<ApiReminder[]>('getUpcomingReminders', {});
    const route = await routeData<ApiReminder[]>('/api/v1/reminders?isActive=true');

    expect(tool).toHaveLength(1);
    expect(tool[0].reminder.expenseAmount).toBe(REMINDER_AMOUNT);
    expect(tool).toEqual(route);
  });
});

describe('assistant tools scope a shared vehicle to the OWNER books, like the routes', () => {
  /** The owner shares the seeded vehicle with B at `level`; B accepts. */
  async function share(vehicleId: string, level: 'viewer' | 'editor'): Promise<void> {
    const invite = await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: bEmail, level });
    const body = await json<DataEnvelope<{ id: string }>>(invite);
    expect(invite.status, JSON.stringify(body)).toBeLessThan(300);
    expect((await asB('POST', `/api/v1/shares/${body.data.id}/accept`)).status).toBe(200);
  }

  async function routeDataAsB<T>(path: string): Promise<T> {
    const res = await asB('GET', path);
    const body = await json<DataEnvelope<T>>(res);
    expect(res.status, `B GET ${path}: ${JSON.stringify(body)}`).toBe(200);
    return body.data;
  }

  test("getExpenseSummary for a sharee matches the sharee's own GET /expenses/summary", async () => {
    const vehicleId = await seedFullFixture();
    await share(vehicleId, 'editor');

    const tool = await runTool<ApiExpenseSummary>(
      'getExpenseSummary',
      { range: 'all', vehicleId },
      bUserId
    );
    const route = await routeDataAsB<ApiExpenseSummary>(
      `/api/v1/expenses/summary?vehicleId=${vehicleId}&period=all`
    );

    // The sharee owns none of the vehicle's rows — an acting-user-scoped query reports zeros.
    expect(tool.expenseCount).toBe(ALL_TIME_EXPENSE_COUNT);
    expect(tool.totalAmount).toBe(ALL_TIME_EXPENSES);
    expect(tool).toEqual(route);
  });

  test("getFuelStats for a sharee matches the sharee's own GET /analytics/fuel-stats", async () => {
    const vehicleId = await seedFullFixture();
    await share(vehicleId, 'viewer');

    const tool = await runTool<{
      fillups: { total: number };
      averageCost: { perFillup: number | null };
    }>('getFuelStats', { range: '30d', vehicleId }, bUserId);
    const route = await routeDataAsB<{
      fillups: { total: number };
      averageCost: { perFillup: number | null };
    }>(`/api/v1/analytics/fuel-stats?${analyticsRange()}&vehicleId=${vehicleId}`);

    expect(tool.averageCost.perFillup).toBeCloseTo((FUEL_ONE + FUEL_TWO) / 2, 2);
    expect(tool).toEqual(route);
  });
});
