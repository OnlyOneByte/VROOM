/**
 * recurring-expenses T1 (C96) — pins the SOURCE-TRACEABILITY contract on the expense
 * READ path: a reminder-materialized expense must surface `sourceType`/`sourceId` in the
 * GET *HTTP response*, not merely in the DB row.
 *
 * Why this is distinct from trigger-expense.test.ts: that test reads `source_type` straight
 * off sqlite (bypassing serialization), so it stays green even if a future response mapper
 * stripped the field — which would silently break the T6 "Recurring" badge + the T3 cascade
 * UI that key off `sourceType==='reminder'` / `sourceId`. This locks the OBSERVABLE response
 * (the C91-class positive-contract test: the field IS echoed to the client), and the
 * manual-expense case pins that the value reflects reality (null when there's no source),
 * not a hardcoded literal.
 *
 * Goes through the REAL stack (route → trigger service → split/insert → DB → GET serialize).
 * createTestApp() rewrites env + dynamic-imports DB-bound modules, so keep static imports to
 * the harness + bun:test (mirrors trigger-expense.test.ts).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

/** Minimal shape we assert on — the source-link fields T3/T6 depend on. */
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

async function seedVehicle(): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Honda',
    model: 'Civic',
    year: 2021,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

/** Create an overdue (past startDate => nextDueDate = startDate) expense reminder. */
async function createOverdueExpenseReminder(vehicleId: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/reminders', {
    name: 'Monthly insurance premium',
    type: 'expense',
    frequency: 'monthly',
    startDate: '2024-01-15T00:00:00.000Z', // well in the past => immediately overdue
    vehicleIds: [vehicleId],
    expenseCategory: 'financial',
    expenseAmount: 125.5,
    expenseTags: ['insurance'],
  });
  const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.reminder.id;
}

/** Materialize the reminder's due expense(s) via the real trigger path. */
async function triggerAndGetExpenseId(): Promise<void> {
  const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
  const body = await json<DataEnvelope<TriggerResultShape>>(res);
  expect(res.status, JSON.stringify(body)).toBe(200);
  expect(body.data.createdExpenses.length).toBeGreaterThanOrEqual(1);
}

describe('expense source traceability (recurring-expenses T1 — read-path surfacing)', () => {
  test('GET /expenses list echoes sourceType/sourceId for a reminder-materialized expense', async () => {
    const vehicleId = await seedVehicle();
    const reminderId = await createOverdueExpenseReminder(vehicleId);
    await triggerAndGetExpenseId();

    const res = await ctx.authed('GET', '/api/v1/expenses');
    const body = await json<PaginatedExpenses>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);

    const materialized = body.data.find((e) => e.sourceType === 'reminder');
    // The source link is visible in the RESPONSE (not just the DB row) — this is the
    // contract the T6 "Recurring" badge reads. A dropped mapper would fail HERE.
    expect(materialized, 'no expense with sourceType=reminder in GET response').toBeDefined();
    expect(materialized?.sourceId).toBe(reminderId);
  });

  test('GET /expenses/:id echoes the source link', async () => {
    const vehicleId = await seedVehicle();
    const reminderId = await createOverdueExpenseReminder(vehicleId);
    await triggerAndGetExpenseId();

    // Find the materialized row via the list, then fetch it by id.
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
    // Create a plain expense through the API (no reminder source).
    const createRes = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc', // no fuel-specific volume/mileage refinement; a plain manual expense
      expenseAmount: 42,
      date: '2024-03-10T00:00:00.000Z',
    });
    const created = await json<DataEnvelope<ExpenseResponse>>(createRes);
    expect(createRes.status, JSON.stringify(created)).toBe(201);

    const res = await ctx.authed('GET', `/api/v1/expenses/${created.data.id}`);
    const body = await json<DataEnvelope<ExpenseResponse>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    // The field reflects reality — a non-recurring expense has no source link.
    expect(body.data.sourceType ?? null).toBeNull();
    expect(body.data.sourceId ?? null).toBeNull();
  });
});

/**
 * #62 (C190): the manual create/update route accepts ONLY sourceType 'financing' (which it fully
 * validates). 'insurance_term' + 'reminder' expenses are created exclusively by system paths that
 * BYPASS this route (insurance hooks / the reminder trigger — verified firsthand), so accepting them
 * on the manual route was pure over-permissiveness: a hand-crafted POST/PUT could forge an UNVALIDATED
 * source link on the caller's own row (skews source-bucketed analytics + a matching sourceId would
 * cascade-delete the manual expense when its parent is removed). These pin the enum restriction.
 */
describe('#62 — manual expense route rejects system-only sourceTypes', () => {
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
});

// #109 (C372): the create schema enforces both-or-neither for sourceType/sourceId via .refine(), but
// .refine() does NOT survive the update schema's .partial()/.omit() re-derivation and was never re-added —
// so a PUT could persist an ASYMMETRIC source link (one of the pair without the other), the #62/#34
// within-tenant integrity class: it skews source-bucketed analytics and a half-link with a real sourceId
// would mis-/never-trigger the financing cascade-delete cleanup. The create path forbids this; now the
// update path does too. (The vehicleId/source seeds use the manual route's only-allowed sourceType,
// 'financing'; here we only need the asymmetry to trip the refine, so the id can be any string.)
describe('#109 — PUT rejects an asymmetric sourceType/sourceId (both-or-neither, mirroring create)', () => {
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

  test('PUT with sourceId but NO sourceType → 400 (asymmetric, was unguarded on update)', async () => {
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
