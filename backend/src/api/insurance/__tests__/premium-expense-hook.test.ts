/**
 * The premium-to-expense hook over HTTP. A costed term creates an even-split insurance expense per covered
 * vehicle. Updating the term replaces those expenses, and deleting the term removes them. Reads rows from sqlite.
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

const seedVehicle = (make: string): Promise<string> =>
  seedVehicleShared(ctx, { make, model: 'Test', year: 2022 });

interface PolicyRow {
  id: string;
  terms: { id: string }[];
}

async function createPolicy(
  vehicleIds: string[],
  totalCost: number
): Promise<{ policyId: string; termId: string }> {
  const res = await ctx.authed('POST', '/api/v1/insurance', {
    company: 'Acme Mutual',
    terms: [
      {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2025-01-01T00:00:00.000Z',
        policyNumber: 'POL-9',
        totalCost,
        vehicleCoverage: { vehicleIds },
      },
    ],
  });
  const body = await json<DataEnvelope<PolicyRow>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return { policyId: body.data.id, termId: body.data.terms[0].id };
}

/** Creates a policy whose single term is priced monthly, with no totalCost. */
async function createMonthlyPolicy(
  vehicleIds: string[],
  monthlyCost: number
): Promise<{ policyId: string; termId: string }> {
  const res = await ctx.authed('POST', '/api/v1/insurance', {
    company: 'Acme Mutual',
    terms: [
      {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2025-01-01T00:00:00.000Z',
        policyNumber: 'POL-M',
        monthlyCost,
        vehicleCoverage: { vehicleIds },
      },
    ],
  });
  const body = await json<DataEnvelope<PolicyRow>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return { policyId: body.data.id, termId: body.data.terms[0].id };
}

interface InsExpenseRow {
  id: string;
  expense_amount: number;
  vehicle_id: string;
  category: string;
  tags: string | null;
  source_type: string | null;
  source_id: string | null;
}

function autoExpensesForTerm(termId: string): InsExpenseRow[] {
  return ctx.sqlite
    .query(
      'SELECT id, expense_amount, vehicle_id, category, tags, source_type, source_id FROM expenses WHERE source_type = ? AND source_id = ?'
    )
    .all('insurance_term', termId) as InsExpenseRow[];
}

describe('insurance premium → expense hook lifecycle', () => {
  test('policy create with a costed 2-vehicle term auto-creates an even-split insurance expense per vehicle', async () => {
    const v1 = await seedVehicle('Honda');
    const v2 = await seedVehicle('Toyota');
    const { termId } = await createPolicy([v1, v2], 1200);

    const rows = autoExpensesForTerm(termId);
    expect(rows).toHaveLength(2);
    const total = rows.reduce((s, r) => s + r.expense_amount, 0);
    expect(total).toBe(120000);
    for (const r of rows) {
      expect(r.expense_amount).toBe(60000);
      expect(r.category).toBe('financial');
      expect(r.tags ?? '').toContain('insurance');
      expect(r.source_type).toBe('insurance_term');
      expect(r.source_id).toBe(termId);
    }
    expect(new Set(rows.map((r) => r.vehicle_id))).toEqual(new Set([v1, v2]));
  });

  // Uneven legs must still sum exactly to the total: a rounding bug would lose or invent a cent.
  test('a non-even premium split across three vehicles sums exactly to the total', async () => {
    const v1 = await seedVehicle('Honda');
    const v2 = await seedVehicle('Toyota');
    const v3 = await seedVehicle('Mazda');
    const { termId } = await createPolicy([v1, v2, v3], 100);

    const rows = autoExpensesForTerm(termId);
    expect(rows).toHaveLength(3);

    const totalCents = rows.reduce((s, r) => s + r.expense_amount, 0);
    expect(totalCents).toBe(10000);

    // Largest remainder: two legs at 3333 and one at 3334.
    const cents = rows.map((r) => r.expense_amount).sort((a, b) => a - b);
    expect(cents).toEqual([3333, 3333, 3334]);
    expect(new Set(rows.map((r) => r.vehicle_id))).toEqual(new Set([v1, v2, v3]));
  });

  // 2024-01-01 to 2025-01-01 spans 13 inclusive month keys, so $100 a month materializes as $1300.
  test('a monthly-only term materializes monthlyCost times its months', async () => {
    const v1 = await seedVehicle('Honda');
    const { termId } = await createMonthlyPolicy([v1], 100);

    const rows = autoExpensesForTerm(termId);
    expect(rows).toHaveLength(1); // one covered vehicle → one sibling
    expect(rows[0].expense_amount).toBe(130000);
    expect(rows[0].category).toBe('financial');
    expect(rows[0].tags ?? '').toContain('insurance');
    expect(rows[0].source_type).toBe('insurance_term');
  });

  test('an explicit totalCost takes precedence over monthlyCost', async () => {
    const v1 = await seedVehicle('Honda');
    const res = await ctx.authed('POST', '/api/v1/insurance', {
      company: 'Acme Mutual',
      terms: [
        {
          startDate: '2024-01-01T00:00:00.000Z',
          endDate: '2025-01-01T00:00:00.000Z',
          policyNumber: 'POL-B',
          totalCost: 1200,
          monthlyCost: 100,
          vehicleCoverage: { vehicleIds: [v1] },
        },
      ],
    });
    const body = await json<DataEnvelope<PolicyRow>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    const rows = autoExpensesForTerm(body.data.terms[0].id);
    expect(rows).toHaveLength(1);
    expect(rows[0].expense_amount).toBe(120000);
  });

  test('updating the term cost regenerates the auto-expenses at the new amount', async () => {
    const v1 = await seedVehicle('Honda');
    const { policyId, termId } = await createPolicy([v1], 1000);
    const before = autoExpensesForTerm(termId);
    expect(before).toHaveLength(1);
    expect(before[0].expense_amount).toBe(100000);
    const beforeId = before[0].id;

    const res = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/terms/${termId}`, {
      totalCost: 1500,
    });
    expect(res.status, await res.text()).toBeLessThan(300);

    const after = autoExpensesForTerm(termId);
    expect(after).toHaveLength(1);
    expect(after[0].expense_amount).toBe(150000);
    // Regenerated, not mutated in place.
    expect(after[0].id).not.toBe(beforeId);
  });

  test('updating the term cost to 0 removes the auto-expenses', async () => {
    const v1 = await seedVehicle('Honda');
    const { policyId, termId } = await createPolicy([v1], 800);
    expect(autoExpensesForTerm(termId)).toHaveLength(1);

    const res = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/terms/${termId}`, {
      totalCost: 0,
    });
    expect(res.status, await res.text()).toBeLessThan(300);

    expect(autoExpensesForTerm(termId)).toHaveLength(0);
  });

  test('deleting the term removes its auto-expenses', async () => {
    const v1 = await seedVehicle('Honda');
    const { policyId, termId } = await createPolicy([v1], 900);
    expect(autoExpensesForTerm(termId)).toHaveLength(1);

    const res = await ctx.authed('DELETE', `/api/v1/insurance/${policyId}/terms/${termId}`);
    expect(res.status, await res.text()).toBeLessThan(300);

    expect(autoExpensesForTerm(termId)).toHaveLength(0);
  });
});
