import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle as seedVehicleShared } from '../../../test-helpers/seed';
import { termBillingMonths } from '../../../utils/calculations';
import { effectiveTermCost, recalculateOvercountedMonthlyPremiums } from '../hooks';

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

async function createMonthlyPolicy(
  vehicleIds: string[],
  monthlyCost: number,
  startDate = '2024-01-01T00:00:00.000Z',
  endDate = '2025-01-01T00:00:00.000Z'
): Promise<{ policyId: string; termId: string }> {
  const res = await ctx.authed('POST', '/api/v1/insurance', {
    company: 'Acme Mutual',
    terms: [
      {
        startDate,
        endDate,
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

  test('a non-even premium split across three vehicles sums exactly to the total', async () => {
    const v1 = await seedVehicle('Honda');
    const v2 = await seedVehicle('Toyota');
    const v3 = await seedVehicle('Mazda');
    const { termId } = await createPolicy([v1, v2, v3], 100);

    const rows = autoExpensesForTerm(termId);
    expect(rows).toHaveLength(3);

    const totalCents = rows.reduce((s, r) => s + r.expense_amount, 0);
    expect(totalCents).toBe(10000);

    const cents = rows.map((r) => r.expense_amount).sort((a, b) => a - b);
    expect(cents).toEqual([3333, 3333, 3334]);
    expect(new Set(rows.map((r) => r.vehicle_id))).toEqual(new Set([v1, v2, v3]));
  });

  test('a monthly-only term materializes monthlyCost times its billed months', async () => {
    const v1 = await seedVehicle('Honda');
    const { termId } = await createMonthlyPolicy([v1], 100);

    const rows = autoExpensesForTerm(termId);
    expect(rows).toHaveLength(1);
    expect(rows[0].expense_amount).toBe(120000);
    expect(rows[0].category).toBe('financial');
    expect(rows[0].tags ?? '').toContain('insurance');
    expect(rows[0].source_type).toBe('insurance_term');
  });

  test('a six-month mid-month term is charged six months, not seven', async () => {
    const v1 = await seedVehicle('Honda');
    const { termId } = await createMonthlyPolicy(
      [v1],
      100,
      '2026-03-15T12:00:00.000Z',
      '2026-09-15T12:00:00.000Z'
    );

    const rows = autoExpensesForTerm(termId);
    expect(rows).toHaveLength(1);
    expect(rows[0].expense_amount).toBe(60000);
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

const utcNoon = (iso: string): Date => new Date(`${iso}T12:00:00.000Z`);

describe('termBillingMonths: start inclusive, end exclusive, one month per started billing period', () => {
  test.each([
    ['2024-01-01', '2025-01-01', 12],
    ['2026-03-15', '2026-09-15', 6],
    ['2026-03-15', '2026-04-15', 1],
    ['2026-03-15', '2026-04-14', 1],
    ['2026-03-15', '2026-04-16', 2],
    ['2026-01-15', '2026-03-20', 3],
    ['2026-01-31', '2026-02-28', 1],
    ['2026-01-31', '2026-03-31', 2],
    ['2026-01-31', '2026-03-01', 2],
    ['2024-01-31', '2024-02-29', 1],
    ['2024-01-31', '2024-03-01', 2],
    ['2024-02-29', '2025-02-28', 12],
    ['2024-02-29', '2025-03-01', 13],
    ['2023-02-28', '2024-02-28', 12],
    ['2023-02-28', '2024-02-29', 13],
    ['2025-12-01', '2026-01-01', 1],
    ['2025-11-30', '2026-05-30', 6],
    ['2026-03-15', '2026-03-16', 1],
    ['2026-03-15', '2026-03-15', 1],
  ])('%s -> %s is %i months', (start, end, months) => {
    expect(termBillingMonths(utcNoon(start), utcNoon(end))).toBe(months);
  });

  test('time of day within the end date does not add a month', () => {
    expect(
      termBillingMonths(new Date('2026-03-15T23:30:00.000Z'), new Date('2026-09-15T00:30:00.000Z'))
    ).toBe(6);
  });

  test('effectiveTermCost charges nothing for a monthly term with no end date', () => {
    expect(
      effectiveTermCost({ totalCost: 0, monthlyCost: 100, startDate: utcNoon('2026-03-15') })
    ).toBe(0);
  });
});

describe('recalculating premiums written before the billing-month fix', () => {
  const YEAR_START = '2024-01-01T12:00:00.000Z';
  const YEAR_END = '2025-01-01T12:00:00.000Z';

  function writeOvercountedPremium(termId: string, perVehicleCents: number[]): void {
    const rows = autoExpensesForTerm(termId).sort((a, b) => a.id.localeCompare(b.id));
    const groupTotal = perVehicleCents.reduce((sum, cents) => sum + cents, 0);
    rows.forEach((row, index) => {
      ctx.sqlite
        .query('UPDATE expenses SET expense_amount = ?, group_total = ? WHERE id = ?')
        .run(perVehicleCents[index] ?? 0, groupTotal, row.id);
    });
  }

  function groupIdsForTerm(termId: string): string[] {
    return (
      ctx.sqlite
        .query('SELECT DISTINCT group_id FROM expenses WHERE source_type = ? AND source_id = ?')
        .all('insurance_term', termId) as { group_id: string }[]
    ).map((row) => row.group_id);
  }

  test('rewrites an over-counted split premium once and leaves it alone on the next run', async () => {
    const v1 = await seedVehicle('Honda');
    const v2 = await seedVehicle('Toyota');
    const { termId } = await createMonthlyPolicy([v1, v2], 100, YEAR_START, YEAR_END);
    const groupBefore = groupIdsForTerm(termId);
    writeOvercountedPremium(termId, [65000, 65000]);

    expect(await recalculateOvercountedMonthlyPremiums()).toBe(1);

    const rows = autoExpensesForTerm(termId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.expense_amount)).toEqual([60000, 60000]);
    expect(new Set(rows.map((r) => r.vehicle_id))).toEqual(new Set([v1, v2]));
    expect(groupIdsForTerm(termId)).toEqual(groupBefore);

    expect(await recalculateOvercountedMonthlyPremiums()).toBe(0);
    expect(autoExpensesForTerm(termId).map((r) => r.expense_amount)).toEqual([60000, 60000]);
  });

  test('a premium whose amount matches neither count is treated as a user edit and kept', async () => {
    const v1 = await seedVehicle('Honda');
    const { termId } = await createMonthlyPolicy([v1], 100, YEAR_START, YEAR_END);
    writeOvercountedPremium(termId, [99900]);

    expect(await recalculateOvercountedMonthlyPremiums()).toBe(0);
    expect(autoExpensesForTerm(termId)[0]?.expense_amount).toBe(99900);
  });

  test('a term priced by totalCost is never rewritten, even with a monthlyCost', async () => {
    const v1 = await seedVehicle('Honda');
    const res = await ctx.authed('POST', '/api/v1/insurance', {
      company: 'Acme Mutual',
      terms: [
        {
          startDate: YEAR_START,
          endDate: YEAR_END,
          totalCost: 1300,
          monthlyCost: 100,
          vehicleCoverage: { vehicleIds: [v1] },
        },
      ],
    });
    const body = await json<DataEnvelope<PolicyRow>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    const termId = body.data.terms[0].id;

    expect(await recalculateOvercountedMonthlyPremiums()).toBe(0);
    expect(autoExpensesForTerm(termId)[0]?.expense_amount).toBe(130000);
  });

  test('a split whose rows no longer add up to the group total is kept', async () => {
    const v1 = await seedVehicle('Honda');
    const v2 = await seedVehicle('Toyota');
    const { termId } = await createMonthlyPolicy([v1, v2], 100, YEAR_START, YEAR_END);
    writeOvercountedPremium(termId, [65000, 65000]);
    const [edited] = autoExpensesForTerm(termId);
    ctx.sqlite
      .query('UPDATE expenses SET expense_amount = 50000 WHERE id = ?')
      .run(edited?.id ?? '');

    expect(await recalculateOvercountedMonthlyPremiums()).toBe(0);
    expect(
      autoExpensesForTerm(termId)
        .map((r) => r.expense_amount)
        .sort((a, b) => a - b)
    ).toEqual([50000, 65000]);
  });
});

describe('term update date validation against the stored dates', () => {
  test('an endDate-only update before the stored start date is rejected and the premium kept', async () => {
    const v1 = await seedVehicle('Honda');
    const { policyId, termId } = await createMonthlyPolicy([v1], 100);

    const res = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/terms/${termId}`, {
      endDate: '2023-06-01T00:00:00.000Z',
    });

    expect(res.status, await res.text()).toBe(400);
    expect(autoExpensesForTerm(termId)[0]?.expense_amount).toBe(120000);
  });

  test('a startDate-only update after the stored end date is rejected', async () => {
    const v1 = await seedVehicle('Honda');
    const { policyId, termId } = await createMonthlyPolicy([v1], 100);

    const res = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/terms/${termId}`, {
      startDate: '2025-01-01T00:00:00.000Z',
    });

    expect(res.status, await res.text()).toBe(400);
  });

  test('an endDate-only update after the stored start date still succeeds', async () => {
    const v1 = await seedVehicle('Honda');
    const { policyId, termId } = await createMonthlyPolicy([v1], 100);

    const res = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/terms/${termId}`, {
      endDate: '2024-07-01T00:00:00.000Z',
    });

    expect(res.status, await res.text()).toBeLessThan(300);
    expect(autoExpensesForTerm(termId)[0]?.expense_amount).toBe(60000);
  });
});
