import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle as seedVehicleShared } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface ExpenseResponse {
  id: string;
  vehicleId: string;
  category: string;
  amount: number;
  sourceType?: string | null;
  sourceId?: string | null;
}

interface PaginatedExpenses {
  success: true;
  data: ExpenseResponse[];
  pagination: { totalCount: number; limit: number; offset: number; hasMore: boolean };
}

interface TriggerResultShape {
  createdExpenses: Array<{ id: string }>;
  notifications: unknown[];
  skipped: Array<{ reminderId: string; reason: string }>;
}

interface SplitResponse {
  success: true;
  data: { groupId: string; groupTotal: number; splitMethod: string };
}

const seedVehicle = (): Promise<string> =>
  seedVehicleShared(ctx, { make: 'Honda', model: 'Civic', year: 2021 });

async function createOverdueExpenseReminder(vehicleId: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/reminders', {
    name: 'Monthly insurance premium',
    type: 'expense',
    frequency: 'monthly',
    startDate: '2024-01-15T00:00:00.000Z',
    vehicleIds: [vehicleId],
    expenseCategory: 'financial',
    expenseAmount: 125.5,
    expenseTags: ['insurance'],
  });
  const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.reminder.id;
}

async function triggerAndGetExpenseId(): Promise<void> {
  const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
  const body = await json<DataEnvelope<TriggerResultShape>>(res);
  expect(res.status, JSON.stringify(body)).toBe(200);
  expect(body.data.createdExpenses.length).toBeGreaterThanOrEqual(1);
}

describe('expense source traceability', () => {
  test('GET /expenses list echoes sourceType/sourceId for a reminder-materialized expense', async () => {
    const vehicleId = await seedVehicle();
    const reminderId = await createOverdueExpenseReminder(vehicleId);
    await triggerAndGetExpenseId();

    const res = await ctx.authed('GET', '/api/v1/expenses');
    const body = await json<PaginatedExpenses>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);

    const materialized = body.data.find((e) => e.sourceType === 'reminder');
    expect(materialized, 'no expense with sourceType=reminder in GET response').toBeDefined();
    expect(materialized?.sourceId).toBe(reminderId);
  });

  test('GET /expenses/:id echoes the source link', async () => {
    const vehicleId = await seedVehicle();
    const reminderId = await createOverdueExpenseReminder(vehicleId);
    await triggerAndGetExpenseId();

    const listRes = await ctx.authed('GET', '/api/v1/expenses');
    const list = await json<PaginatedExpenses>(listRes);
    const id = list.data.find((e) => e.sourceType === 'reminder')?.id;
    expect(id, 'no materialized expense found to fetch by id').toBeDefined();

    const res = await ctx.authed('GET', `/api/v1/expenses/${id}`);
    const body = await json<DataEnvelope<ExpenseResponse>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.sourceType).toBe('reminder');
    expect(body.data.sourceId).toBe(reminderId);
  });

  test('a manually-created expense reports no source (null, not a hardcoded value)', async () => {
    const vehicleId = await seedVehicle();
    const createRes = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 42,
      date: '2024-03-10T00:00:00.000Z',
    });
    const created = await json<DataEnvelope<ExpenseResponse>>(createRes);
    expect(createRes.status, JSON.stringify(created)).toBe(201);

    const res = await ctx.authed('GET', `/api/v1/expenses/${created.data.id}`);
    const body = await json<DataEnvelope<ExpenseResponse>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.sourceType ?? null).toBeNull();
    expect(body.data.sourceId ?? null).toBeNull();
  });
});

describe('manual expense route rejects system-only sourceTypes', () => {
  test('POST with sourceType "reminder" is rejected 400 (system-only — never via the manual route)', async () => {
    const vehicleId = await seedVehicle();
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 20,
      date: '2024-03-10T00:00:00.000Z',
      sourceType: 'reminder',
      sourceId: 'forged-reminder-id',
    });
    expect(res.status).toBe(400);
  });

  test('POST with sourceType "insurance_term" is rejected 400 too', async () => {
    const vehicleId = await seedVehicle();
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'financial',
      expenseAmount: 30,
      date: '2024-03-10T00:00:00.000Z',
      sourceType: 'insurance_term',
      sourceId: 'forged-term-id',
    });
    expect(res.status).toBe(400);
  });

  test('PUT with sourceType "reminder" is rejected 400 (the update path is restricted too)', async () => {
    const vehicleId = await seedVehicle();
    const createRes = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 15,
      date: '2024-03-11T00:00:00.000Z',
    });
    const created = await json<DataEnvelope<ExpenseResponse>>(createRes);
    expect(createRes.status, JSON.stringify(created)).toBe(201);

    const res = await ctx.authed('PUT', `/api/v1/expenses/${created.data.id}`, {
      sourceType: 'reminder',
      sourceId: 'forged-reminder-id',
    });
    expect(res.status).toBe(400);
  });

  test('a plain manual expense with NO source still creates fine (the enum restriction is not over-broad)', async () => {
    const vehicleId = await seedVehicle();
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 18,
      date: '2024-03-12T00:00:00.000Z',
    });
    expect(res.status).toBe(201);
  });

  test('POST /split with a system-only sourceType "insurance_term" is rejected 400', async () => {
    const vehicleId = await seedVehicle();
    const res = await ctx.authed('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [vehicleId] },
      category: 'financial',
      totalAmount: 40,
      date: '2024-03-13T00:00:00.000Z',
      sourceType: 'insurance_term',
      sourceId: 'forged-term-id',
    });
    expect(res.status).toBe(400);
  });

  test('POST /split with sourceType "financing" but a bogus sourceId is rejected (per-vehicle validation)', async () => {
    const vehicleId = await seedVehicle();
    const res = await ctx.authed('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [vehicleId] },
      category: 'financial',
      totalAmount: 40,
      date: '2024-03-13T00:00:00.000Z',
      sourceType: 'financing',
      sourceId: 'no-such-financing',
    });
    expect(res.status).toBe(400);
  });

  test('POST /split with NO source still creates fine (the restriction is not over-broad)', async () => {
    const vehicleId = await seedVehicle();
    const res = await ctx.authed('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [vehicleId] },
      category: 'misc',
      totalAmount: 25,
      date: '2024-03-13T00:00:00.000Z',
    });
    expect(res.status).toBe(201);
  });
});

describe('PUT rejects an asymmetric sourceType/sourceId (both-or-neither, mirroring create)', () => {
  async function seedPlainExpense(): Promise<string> {
    const vehicleId = await seedVehicle();
    const createRes = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 20,
      date: '2024-04-01T00:00:00.000Z',
    });
    const created = await json<DataEnvelope<ExpenseResponse>>(createRes);
    expect(createRes.status, JSON.stringify(created)).toBe(201);
    return created.data.id;
  }

  test('PUT with sourceId but no sourceType is rejected with 400', async () => {
    const id = await seedPlainExpense();
    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, {
      sourceId: 'fin-orphan-id',
    });
    expect(res.status).toBe(400);
  });

  test('PUT with sourceType but NO sourceId → 400 (the mirror asymmetry)', async () => {
    const id = await seedPlainExpense();
    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, {
      sourceType: 'financing',
    });
    expect(res.status).toBe(400);
  });

  test('PUT with NEITHER (a normal unrelated edit) is accepted — the refine is not over-broad', async () => {
    const id = await seedPlainExpense();
    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, {
      expenseAmount: 25,
    });
    expect(res.status).toBe(200);
  });
});

describe('PUT verifies a financing source link (not just the asymmetry/enum)', () => {
  async function seedPlainExpense(vehicleId: string): Promise<string> {
    const createRes = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'financial',
      expenseAmount: 20,
      date: '2024-05-01T00:00:00.000Z',
    });
    const created = await json<DataEnvelope<ExpenseResponse>>(createRes);
    expect(createRes.status, JSON.stringify(created)).toBe(201);
    return created.data.id;
  }

  test('PUT {sourceType:financing, sourceId:forged} on a vehicle with NO financing → 400', async () => {
    const vehicleId = await seedVehicle();
    const id = await seedPlainExpense(vehicleId);
    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, {
      sourceType: 'financing',
      sourceId: 'forged-financing-id',
    });
    expect(res.status).toBe(400);
  });

  test('PUT linking to the vehicle ACTUAL active financing succeeds (the check is not over-broad)', async () => {
    const vehicleId = await seedVehicle();
    const id = await seedPlainExpense(vehicleId);
    const finRes = await ctx.authed('POST', `/api/v1/financing/vehicles/${vehicleId}/financing`, {
      financingType: 'loan',
      provider: 'TestBank',
      originalAmount: 20000,
      termMonths: 60,
      startDate: '2024-01-01T00:00:00.000Z',
      paymentAmount: 400,
      apr: 5,
    });
    const fin = await json<DataEnvelope<{ id: string }>>(finRes);
    expect(finRes.status, JSON.stringify(fin)).toBeLessThan(300);

    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, {
      sourceType: 'financing',
      sourceId: fin.data.id,
    });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  test('PUT linking to a sourceId that does NOT match the vehicle active financing → 400', async () => {
    const vehicleId = await seedVehicle();
    const id = await seedPlainExpense(vehicleId);
    const finRes = await ctx.authed('POST', `/api/v1/financing/vehicles/${vehicleId}/financing`, {
      financingType: 'loan',
      provider: 'TestBank',
      originalAmount: 10000,
      termMonths: 36,
      startDate: '2024-01-01T00:00:00.000Z',
      paymentAmount: 300,
      apr: 4,
    });
    expect(finRes.status, await finRes.clone().text()).toBeLessThan(300);

    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, {
      sourceType: 'financing',
      sourceId: 'a-different-id-not-the-active-one',
    });
    expect(res.status).toBe(400);
  });

  test('POST {sourceType:financing, sourceId:forged} on a vehicle with NO financing → 400 (POST call site)', async () => {
    const vehicleId = await seedVehicle();
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'financial',
      expenseAmount: 30,
      date: '2024-06-01T00:00:00.000Z',
      sourceType: 'financing',
      sourceId: 'forged-financing-id',
    });
    expect(res.status).toBe(400);
  });

  test('POST linking to the vehicle ACTUAL active financing succeeds (POST call site not over-broad)', async () => {
    const vehicleId = await seedVehicle();
    const finRes = await ctx.authed('POST', `/api/v1/financing/vehicles/${vehicleId}/financing`, {
      financingType: 'loan',
      provider: 'TestBank',
      originalAmount: 18000,
      termMonths: 48,
      startDate: '2024-01-01T00:00:00.000Z',
      paymentAmount: 375,
      apr: 5,
    });
    const fin = await json<DataEnvelope<{ id: string }>>(finRes);
    expect(finRes.status, JSON.stringify(fin)).toBeLessThan(300);

    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'financial',
      expenseAmount: 375,
      date: '2024-06-01T00:00:00.000Z',
      sourceType: 'financing',
      sourceId: fin.data.id,
    });
    expect(res.status, await res.clone().text()).toBe(201);
  });
});

describe('PUT /split re-validates the carried financing source against the NEW vehicle set', () => {
  async function seedVehicleWithFinancing(): Promise<{ vehicleId: string; financingId: string }> {
    const vehicleId = await seedVehicle();
    const finRes = await ctx.authed('POST', `/api/v1/financing/vehicles/${vehicleId}/financing`, {
      financingType: 'loan',
      provider: 'TestBank',
      originalAmount: 20000,
      termMonths: 60,
      startDate: '2024-01-01T00:00:00.000Z',
      paymentAmount: 400,
      apr: 5,
    });
    const fin = await json<DataEnvelope<{ id: string }>>(finRes);
    expect(finRes.status, JSON.stringify(fin)).toBeLessThan(300);
    return { vehicleId, financingId: fin.data.id };
  }

  test('reallocating a financing-sourced split onto a vehicle WITHOUT that financing → 400', async () => {
    const { vehicleId: vehA, financingId } = await seedVehicleWithFinancing();
    const vehB = await seedVehicle();

    const createRes = await ctx.authed('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [vehA] },
      category: 'financial',
      totalAmount: 400,
      date: '2024-07-01T00:00:00.000Z',
      sourceType: 'financing',
      sourceId: financingId,
    });
    const created = await json<SplitResponse>(createRes);
    expect(createRes.status, JSON.stringify(created)).toBe(201);

    const res = await ctx.authed('PUT', `/api/v1/expenses/split/${created.data.groupId}`, {
      splitConfig: { method: 'even', vehicleIds: [vehB] },
      totalAmount: 400,
    });
    expect(res.status, await res.clone().text()).toBe(400);
  });

  test('reallocating within the same financed vehicle still succeeds', async () => {
    const { vehicleId, financingId } = await seedVehicleWithFinancing();
    const createRes = await ctx.authed('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [vehicleId] },
      category: 'financial',
      totalAmount: 400,
      date: '2024-07-01T00:00:00.000Z',
      sourceType: 'financing',
      sourceId: financingId,
    });
    const created = await json<SplitResponse>(createRes);
    expect(createRes.status, JSON.stringify(created)).toBe(201);

    const res = await ctx.authed('PUT', `/api/v1/expenses/split/${created.data.groupId}`, {
      splitConfig: { method: 'even', vehicleIds: [vehicleId] },
      totalAmount: 500,
    });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  test('a SOURCE-LESS split reallocates freely across vehicles (no financing link to re-check)', async () => {
    const vehA = await seedVehicle();
    const vehB = await seedVehicle();
    const createRes = await ctx.authed('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [vehA] },
      category: 'misc',
      totalAmount: 30,
      date: '2024-07-01T00:00:00.000Z',
    });
    const created = await json<SplitResponse>(createRes);
    expect(createRes.status, JSON.stringify(created)).toBe(201);

    const res = await ctx.authed('PUT', `/api/v1/expenses/split/${created.data.groupId}`, {
      splitConfig: { method: 'even', vehicleIds: [vehB] },
      totalAmount: 30,
    });
    expect(res.status, await res.clone().text()).toBe(200);
  });
});
