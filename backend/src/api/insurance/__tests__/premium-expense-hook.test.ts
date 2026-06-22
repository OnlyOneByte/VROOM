/**
 * In-process HTTP tests for the insurance premium → expense HOOK lifecycle
 * (insurance/hooks.ts), which auto-creates a split expense across covered
 * vehicles when a term carries a totalCost. terms-http.test only covers the
 * clear-optional-field semantics; this auto-created-FINANCIAL-RECORD lifecycle
 * had no HTTP characterization. Drives the real stack (route → hook →
 * createSplitExpense / deleteBySource → DB) and reads rows off sqlite:
 *   - policy create with a costed, 2-vehicle term → one insurance expense per
 *     vehicle, even-split, tagged 'insurance', source_type='insurance_term'
 *   - term update to a NEW totalCost → old auto-expenses gone, new ones at the
 *     new amount (the delete-by-source + recreate path)
 *   - term update to totalCost 0 → no auto-expenses remain
 *   - term delete → auto-expenses removed
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules, so keep static
 * imports to the harness + bun:test.
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

async function seedVehicle(make: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', { make, model: 'Test', year: 2022 });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

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
  return { policyId: body.data.id, termId: body.data.terms[0]!.id };
}

/** Create a policy whose single term is MONTHLY-priced (no totalCost) — the #69 path. */
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
  return { policyId: body.data.id, termId: body.data.terms[0]!.id };
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
    expect(rows).toHaveLength(2); // one sibling per covered vehicle
    // Even split of 1200 across 2 → 600 each (integer-cents largest-remainder).
    const total = rows.reduce((s, r) => s + r.expense_amount, 0);
    expect(total).toBeCloseTo(1200, 2);
    for (const r of rows) {
      expect(r.expense_amount).toBeCloseTo(600, 2);
      expect(r.category).toBe('financial');
      expect(r.tags ?? '').toContain('insurance');
      expect(r.source_type).toBe('insurance_term');
      expect(r.source_id).toBe(termId);
    }
    expect(new Set(rows.map((r) => r.vehicle_id))).toEqual(new Set([v1, v2]));
  });

  // C382: the materialization splits totalCost EVENLY across N covered vehicles via createSplitExpense's
  // integer-cents largest-remainder algorithm. The existing test uses 1200/2=600 (divides evenly), so the
  // REMAINDER-distribution path — where the per-vehicle legs are NOT all equal but MUST still sum exactly
  // to the total — was unpinned at the HTTP/materialization layer (split-service.property.test.ts covers
  // the pure algorithm, but not the insurance term→expense round-trip). A non-even premium ($100 / 3) is
  // the realistic case: a rounding regression would lose or invent a cent on a user's insurance cost
  // (NORTH_STAR #1). Pin that 3 siblings sum to EXACTLY 100.00 and the remainder cent lands on one leg.
  test('a NON-EVEN premium split (100 / 3 vehicles) materializes legs that sum to EXACTLY the total', async () => {
    const v1 = await seedVehicle('Honda');
    const v2 = await seedVehicle('Toyota');
    const v3 = await seedVehicle('Mazda');
    const { termId } = await createPolicy([v1, v2, v3], 100);

    const rows = autoExpensesForTerm(termId);
    expect(rows).toHaveLength(3);

    // Sum in integer cents to assert EXACT (not approximate) conservation — no lost/invented cent.
    const totalCents = rows.reduce((s, r) => s + Math.round(r.expense_amount * 100), 0);
    expect(totalCents).toBe(10000); // exactly $100.00

    // Largest-remainder: two legs at 33.33, one at 33.34 (the remainder cent). Each leg is a real,
    // near-equal share — never a 0 or a >total leg.
    const cents = rows.map((r) => Math.round(r.expense_amount * 100)).sort((a, b) => a - b);
    expect(cents).toEqual([3333, 3333, 3334]);
    expect(new Set(rows.map((r) => r.vehicle_id))).toEqual(new Set([v1, v2, v3]));
  });

  // #69 (C34): a MONTHLY-only term (monthlyCost, no totalCost) previously created NO expense row, so it
  // showed in analytics (effectiveMonthlyPremium honours monthlyCost) but was ABSENT from TCO's
  // insuranceCost bucket — an under-report. The hook now materializes monthlyCost × the term's month span
  // (the same inclusive month count effectiveMonthlyPremium amortizes a totalCost over → symmetric, no
  // double-count: analytics reads term.monthlyCost directly, never these rows). A 2024-01-01 → 2025-01-01
  // term spans 13 month-keys (inclusive both endpoints), so $100/mo → $1300 materialized.
  test('#69: a monthly-only term materializes monthlyCost × term-months into TCO-visible expense rows', async () => {
    const v1 = await seedVehicle('Honda');
    const { termId } = await createMonthlyPolicy([v1], 100);

    const rows = autoExpensesForTerm(termId);
    expect(rows).toHaveLength(1); // one covered vehicle → one sibling
    expect(rows[0]!.expense_amount).toBeCloseTo(1300, 2); // 100/mo × 13 months
    expect(rows[0]!.category).toBe('financial');
    expect(rows[0]!.tags ?? '').toContain('insurance');
    expect(rows[0]!.source_type).toBe('insurance_term');
  });

  test('#69: an explicit totalCost still wins over monthlyCost (no change to the costed path)', async () => {
    // A term with BOTH set uses totalCost verbatim (effectiveTermCost precedence) — pins that the #69
    // monthly path doesn't disturb the existing costed-term materialization.
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
    const rows = autoExpensesForTerm(body.data.terms[0]!.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.expense_amount).toBeCloseTo(1200, 2); // totalCost, not 100×13
  });

  test('updating the term cost regenerates the auto-expenses at the new amount', async () => {
    const v1 = await seedVehicle('Honda');
    const { policyId, termId } = await createPolicy([v1], 1000);
    const before = autoExpensesForTerm(termId);
    expect(before).toHaveLength(1);
    expect(before[0]!.expense_amount).toBeCloseTo(1000, 2);
    const beforeId = before[0]!.id;

    const res = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/terms/${termId}`, {
      totalCost: 1500,
    });
    expect(res.status, await res.text()).toBeLessThan(300);

    const after = autoExpensesForTerm(termId);
    expect(after).toHaveLength(1);
    expect(after[0]!.expense_amount).toBeCloseTo(1500, 2);
    // Regenerated (delete-by-source + recreate), not mutated in place.
    expect(after[0]!.id).not.toBe(beforeId);
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
