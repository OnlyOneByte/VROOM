import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => {
  ctx.sqlite.run('DROP TRIGGER IF EXISTS test_block_expense_update');
  ctx.close();
});

function blockExpenseUpdates(): void {
  ctx.sqlite.run(
    `CREATE TRIGGER test_block_expense_update BEFORE UPDATE ON expenses
     BEGIN SELECT RAISE(ABORT, 'expense update blocked by test'); END`
  );
}

async function seedLoanWithPayment(): Promise<{ financingId: string; expenseId: string }> {
  const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2022 });
  const loanRes = await ctx.authed('POST', `/api/v1/financing/vehicles/${vehicleId}/financing`, {
    financingType: 'loan',
    provider: 'Test Credit Union',
    originalAmount: 20000,
    apr: 5,
    termMonths: 60,
    startDate: '2024-01-01',
    paymentAmount: 380,
    paymentFrequency: 'monthly',
  });
  const loan = await json<DataEnvelope<{ id: string }>>(loanRes);
  expect(loanRes.status, JSON.stringify(loan)).toBeLessThan(300);
  const expenseRes = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'financial',
    expenseAmount: 380,
    date: '2024-02-01T00:00:00.000Z',
    sourceType: 'financing',
    sourceId: loan.data.id,
  });
  const expense = await json<DataEnvelope<{ id: string }>>(expenseRes);
  expect(expenseRes.status, JSON.stringify(expense)).toBeLessThan(300);
  return { financingId: loan.data.id, expenseId: expense.data.id };
}

function financingRow(id: string): { is_active: number; end_date: number | null } {
  return ctx.sqlite
    .query('SELECT is_active, end_date FROM vehicle_financing WHERE id = ?')
    .get(id) as { is_active: number; end_date: number | null };
}

function expenseSource(id: string): string | null {
  const r = ctx.sqlite.query('SELECT source_id FROM expenses WHERE id = ?').get(id) as {
    source_id: string | null;
  };
  return r.source_id;
}

describe('financing payoff is atomic with detaching its payments', () => {
  for (const [method, suffix] of [
    ['PUT', '/payoff'],
    ['DELETE', ''],
  ] as const) {
    test(`${method} fails and keeps the loan active when the payments cannot be detached`, async () => {
      const { financingId, expenseId } = await seedLoanWithPayment();
      blockExpenseUpdates();

      const res = await ctx.authed(method, `/api/v1/financing/${financingId}${suffix}`, {});

      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(financingRow(financingId).is_active).toBe(1);
      expect(financingRow(financingId).end_date).toBeNull();
      expect(expenseSource(expenseId)).toBe(financingId);
    });
  }

  test('a successful payoff deactivates the loan and detaches its payments together', async () => {
    const { financingId, expenseId } = await seedLoanWithPayment();

    const res = await ctx.authed('PUT', `/api/v1/financing/${financingId}/payoff`, {});

    expect(res.status).toBe(200);
    expect(financingRow(financingId).is_active).toBe(0);
    expect(expenseSource(expenseId)).toBeNull();
  });
});
