/**
 * In-process HTTP tests for the onFinancingDeactivated hook (C85 guard, steered by the C81
 * coverage baseline — financing/hooks.ts was at 0% func). The hook is a DATA-INTEGRITY side
 * effect: when financing is paid off (PUT /:id/payoff) or deleted (DELETE /:id), it must SEVER
 * the source link on the financing's auto-generated expenses (clear sourceType/sourceId) while
 * KEEPING the expense rows. Pinned end-to-end through the real routes so the singleton-bound
 * expenseRepository.clearSource runs against the test DB (createTestApp rewrites env — the C68
 * pattern). Also pins the best-effort contract: a no-linked-expenses deactivate still succeeds.
 */

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

// This file's fixture is a nickname-required Honda Civic 2022; converge onto the shared test-helpers/seed
// seedVehicle (arch convergence, Angelo-approved) via a thin wrapper that keeps make/model/year explicit
// (the shared default is a Camry) so behavior is preserved.
const seedVehicle = (nickname: string): Promise<string> =>
  seedVehicleShared(ctx, { make: 'Honda', model: 'Civic', year: 2022, nickname });

/** Create a loan on a vehicle, returning the financing id. */
async function seedLoan(vehicleId: string): Promise<string> {
  const res = await ctx.authed('POST', `/api/v1/financing/vehicles/${vehicleId}/financing`, {
    financingType: 'loan',
    provider: 'Test Credit Union',
    originalAmount: 20000,
    apr: 5,
    termMonths: 60,
    startDate: '2024-01-01',
    paymentAmount: 380,
    paymentFrequency: 'monthly',
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

/** Create an expense linked to a financing source; returns its id. */
async function seedFinancingExpense(vehicleId: string, financingId: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'financial',
    expenseAmount: 380,
    date: '2024-02-01T00:00:00.000Z',
    sourceType: 'financing',
    sourceId: financingId,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

interface ExpenseRow {
  id: string;
  sourceType: string | null;
  sourceId: string | null;
}

async function listExpenses(): Promise<ExpenseRow[]> {
  const res = await ctx.authed('GET', '/api/v1/expenses?limit=100');
  const body = await json<{ data: ExpenseRow[] }>(res);
  return body.data;
}

describe('onFinancingDeactivated — payoff severs the source link but keeps the expense', () => {
  test('PUT /:id/payoff clears sourceType/sourceId on the linked expense, row survives', async () => {
    const vehicleId = await seedVehicle('Financed');
    const financingId = await seedLoan(vehicleId);
    const expenseId = await seedFinancingExpense(vehicleId, financingId);

    // Sanity: the expense starts linked to the financing.
    const before = (await listExpenses()).find((e) => e.id === expenseId);
    expect(before?.sourceType).toBe('financing');
    expect(before?.sourceId).toBe(financingId);

    const res = await ctx.authed('PUT', `/api/v1/financing/${financingId}/payoff`, {});
    expect(res.status).toBe(200);

    const after = (await listExpenses()).find((e) => e.id === expenseId);
    expect(after, 'the expense row must still exist (link severed, not deleted)').toBeDefined();
    expect(after?.sourceType).toBeNull(); // link severed
    expect(after?.sourceId).toBeNull();
  });
});

describe('onFinancingDeactivated — delete also severs the link', () => {
  test('DELETE /:id clears the source link on the linked expense', async () => {
    const vehicleId = await seedVehicle('Financed');
    const financingId = await seedLoan(vehicleId);
    const expenseId = await seedFinancingExpense(vehicleId, financingId);

    const res = await ctx.authed('DELETE', `/api/v1/financing/${financingId}`);
    expect(res.status).toBe(200);

    const after = (await listExpenses()).find((e) => e.id === expenseId);
    expect(after?.sourceType).toBeNull();
    expect(after?.sourceId).toBeNull();
  });
});

describe('onFinancingDeactivated — best-effort (no linked expenses)', () => {
  test('paying off financing with NO linked expenses still succeeds (hook is a no-op, never throws)', async () => {
    const vehicleId = await seedVehicle('NoExpenses');
    const financingId = await seedLoan(vehicleId);

    const res = await ctx.authed('PUT', `/api/v1/financing/${financingId}/payoff`, {});
    expect(res.status).toBe(200); // the financing op is unaffected by the empty cleanup
  });

  test('an UNRELATED expense (different/no source) is left untouched by a payoff', async () => {
    const vehicleId = await seedVehicle('Mixed');
    const financingId = await seedLoan(vehicleId);
    // A plain expense with no source link.
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'fuel',
      expenseAmount: 40,
      date: '2024-02-01T00:00:00.000Z',
      mileage: 1000,
      volume: 10,
    });
    const plain = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(plain)).toBeLessThan(300);

    await ctx.authed('PUT', `/api/v1/financing/${financingId}/payoff`, {});

    const after = (await listExpenses()).find((e) => e.id === plain.data.id);
    expect(after).toBeDefined(); // untouched, still present
    expect(after?.sourceType ?? null).toBeNull();
  });
});
