import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface PolicyBody {
  id: string;
  terms: Array<{ id: string }>;
}

function premiumRows(termId: string): Array<{ id: string; expense_amount: number }> {
  return ctx.sqlite
    .query(
      `SELECT id, expense_amount FROM expenses
        WHERE source_type = 'insurance_term' AND source_id = ?`
    )
    .all(termId) as Array<{ id: string; expense_amount: number }>;
}

async function seedCostedTerm(): Promise<{ policyId: string; termId: string }> {
  const vehicleId = await seedVehicle(ctx, { nickname: 'Insured' });
  const res = await ctx.authed('POST', '/api/v1/insurance', {
    company: 'Acme Mutual',
    terms: [
      {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2025-01-01T00:00:00.000Z',
        totalCost: 1200,
        vehicleCoverage: { vehicleIds: [vehicleId] },
      },
    ],
  });
  const body = await json<DataEnvelope<PolicyBody>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  const termId = body.data.terms[0]?.id;
  expect(termId, 'the seeded policy must have a term').toBeTruthy();
  expect(premiumRows(termId as string).length, 'the costed term must materialize a premium').toBe(
    1
  );
  return { policyId: body.data.id, termId: termId as string };
}

describe('insurance term update premium recreate failure', () => {
  test('reports the failure instead of answering 200', async () => {
    const { policyId, termId } = await seedCostedTerm();
    const { expenseRepository } = await import('../../expenses/repository');
    const spy = spyOn(expenseRepository, 'createSplitExpense').mockImplementation(() => {
      throw new Error('forced recreate failure');
    });

    try {
      const res = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/terms/${termId}`, {
        totalCost: 1500,
      });
      const body = await json<{ success: boolean; error?: { message: string } }>(res);

      expect(premiumRows(termId).length, 'the old premium row was deleted').toBe(0);
      expect(res.status, JSON.stringify(body)).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error?.message).toContain('premium expense could not be recreated');
    } finally {
      spy.mockRestore();
    }
  });

  test('a successful update still answers 200 and re-materializes the premium', async () => {
    const { policyId, termId } = await seedCostedTerm();

    const res = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/terms/${termId}`, {
      totalCost: 1500,
    });
    expect(res.status).toBe(200);
    const rows = premiumRows(termId);
    expect(rows.length).toBe(1);
    expect(rows[0]?.expense_amount).toBe(150_000);
  });
});
