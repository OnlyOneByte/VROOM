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

interface SplitResponse {
  success: true;
  data: { groupId: string; groupTotal: number; splitMethod: string };
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

  // #145 (C465): the SPLIT route (POST /expenses/split) is the THIRD source-link path #125/C422
  // missed — its schema was z.string().optional() (any string) and the handler ran NO
  // assertFinancingSourceValid, so a hand-crafted split could forge an unvalidated reminder/
  // insurance_term link (cascade-delete data-loss vector) OR a 'financing' link to an arbitrary
  // sourceId (understates the displayed loan balance). Now: non-financing rejected at the schema;
  // a financing link is validated per vehicle.
  test('POST /split with a system-only sourceType "insurance_term" is rejected 400 (#145)', async () => {
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

  test('POST /split with sourceType "financing" but a bogus sourceId is rejected (per-vehicle validation) (#145)', async () => {
    const vehicleId = await seedVehicle();
    const res = await ctx.authed('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [vehicleId] },
      category: 'financial',
      totalAmount: 40,
      date: '2024-03-13T00:00:00.000Z',
      sourceType: 'financing',
      sourceId: 'no-such-financing',
    });
    // assertFinancingSourceValid throws ValidationError (no active financing / id mismatch) → 400.
    expect(res.status).toBe(400);
  });

  test('POST /split with NO source still creates fine (the restriction is not over-broad) (#145)', async () => {
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

// #125 (C422): the create path VERIFIES a financing source link points at the vehicle's ACTIVE financing
// (computeBalance sums `source_type='financing' AND source_id=id`, so a forged/mismatched link mis-attributes
// the expense as a loan payment → understates the displayed balance). The PUT path SKIPPED this — it ran the
// both-or-neither refine (#109) + the enum restriction but never the financing-existence/id-match check — so
// a SYMMETRIC `{sourceType:'financing', sourceId:<forged>}` PUT persisted. Now both paths share
// assertFinancingSourceValid. These are the symmetric cases the #62/#109 tests above don't cover.
describe('#125 — PUT verifies a financing source link (not just the asymmetry/enum)', () => {
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

  test('PUT {sourceType:financing, sourceId:forged} on a vehicle with NO financing → 400 (was 200 pre-fix)', async () => {
    const vehicleId = await seedVehicle();
    const id = await seedPlainExpense(vehicleId);
    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, {
      sourceType: 'financing',
      sourceId: 'forged-financing-id',
    });
    expect(res.status).toBe(400); // "Vehicle has no active financing"
  });

  test('PUT linking to the vehicle ACTUAL active financing succeeds (the check is not over-broad)', async () => {
    const vehicleId = await seedVehicle();
    const id = await seedPlainExpense(vehicleId);
    // Create real active financing on the vehicle.
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
    expect(res.status).toBe(400); // "Source ID does not match the active financing record"
  });

  // C425 (guard): C422 extracted assertFinancingSourceValid as ONE source of truth shared by POST + PUT,
  // but the C422 tests above all drive the PUT call site. The POST call site's financing-source
  // verification was previously inline + NEVER directly tested (the #62 POST tests cover only the ENUM
  // rejection of reminder/insurance_term, not the financing existence/id-match) — so a refactor dropping
  // the POST call to the shared helper would go RED nowhere. These pin the POST boundary enforces the
  // contract too, so BOTH call sites of the shared helper are covered (NORTH_STAR #5).
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
    expect(res.status).toBe(400); // "Vehicle has no active financing"
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

// #147 (C2): the SPLIT-UPDATE path (PUT /expenses/split/:id) is the financing-source-link path the
// per-vehicle check (#145 on create, #125 on the regular PUT) missed. updateSplitExpense REGENERATES the
// siblings carrying the group's existing sourceType/sourceId forward (the update schema doesn't expose
// them), but the NEW splitConfig can land them on a DIFFERENT vehicle set. computeBalance sums financing
// payments by (sourceType,sourceId) with NO vehicle scope, so reallocating a financing-sourced split onto
// a vehicle whose active financing isn't that sourceId mis-attributes a loan payment → understates the
// displayed balance (NORTH_STAR #1). The route now re-validates the carried link against the new vehicles
// before regenerating, mirroring the create-split per-vehicle guard.
describe('#147 — PUT /split re-validates the carried financing source against the NEW vehicle set', () => {
  /** Seed a vehicle and (optionally) active loan financing on it; return both ids. */
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

  test('reallocating a financing-sourced split onto a vehicle WITHOUT that financing → 400 (was 200 pre-fix)', async () => {
    // Vehicle A has the loan; create a single-vehicle financing-sourced split on A (valid at create).
    const { vehicleId: vehA, financingId } = await seedVehicleWithFinancing();
    const vehB = await seedVehicle(); // a second vehicle with NO financing

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

    // Now REALLOCATE the same group to vehicle B. The carried-forward financing link (sourceId=A's loan)
    // no longer matches B's active financing (none), so the regenerated sibling would mis-attribute a
    // payment against A's loan from a row on B. Must be rejected.
    const res = await ctx.authed('PUT', `/api/v1/expenses/split/${created.data.groupId}`, {
      splitConfig: { method: 'even', vehicleIds: [vehB] },
      totalAmount: 400,
    });
    expect(res.status, await res.clone().text()).toBe(400); // "Vehicle has no active financing"
  });

  test('reallocating WITHIN the same financed vehicle still succeeds (the guard is not over-broad)', async () => {
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

    // Edit the total but keep the same (financed) vehicle — the carried link still validates.
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
