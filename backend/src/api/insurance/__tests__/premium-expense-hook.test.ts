import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle as seedVehicleShared } from '../../../test-helpers/seed';
import TERM_BILLING_CASES from '../../../utils/__tests__/term-billing-months.cases.json';
import { termBillingMonths } from '../../../utils/calculations';
import { effectiveTermCost, recalculateOvercountedMonthlyPremiums } from '../hooks';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
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

  test('the premium expense names the carrier, not the policy number', async () => {
    const v1 = await seedVehicle('Honda');
    const { policyId, termId } = await createPolicy([v1], 600);
    const describe = (id: string) =>
      ctx.sqlite
        .query('SELECT description FROM expenses WHERE source_type = ? AND source_id = ?')
        .all('insurance_term', id) as Array<{ description: string }>;
    expect(describe(termId)).toEqual([{ description: 'Insurance premium, Acme Mutual' }]);

    const res = await ctx.authed('POST', `/api/v1/insurance/${policyId}/terms`, {
      startDate: '2025-01-01T00:00:00.000Z',
      endDate: '2026-01-01T00:00:00.000Z',
      policyNumber: 'POL-10',
      totalCost: 700,
      vehicleCoverage: { vehicleIds: [v1] },
    });
    const body = await json<DataEnvelope<PolicyRow>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    const added = body.data.terms.find((t) => t.id !== termId);
    expect(describe(added?.id ?? '')).toEqual([{ description: 'Insurance premium, Acme Mutual' }]);
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
  test('the shared case table has rows', () => {
    expect(TERM_BILLING_CASES.length).toBeGreaterThan(0);
  });

  test.each(TERM_BILLING_CASES)('$start -> $end is $months months', ({ start, end, months }) => {
    expect(termBillingMonths(new Date(start), new Date(end))).toBe(months);
  });

  test('effectiveTermCost charges nothing for a monthly term with no end date', () => {
    expect(
      effectiveTermCost({ totalCost: 0, monthlyCost: 100, startDate: utcNoon('2026-03-15') })
    ).toBe(0);
  });
});

describe('recalculating monthly premiums that were overcounted', () => {
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

describe('premium split follows the order the vehicles were chosen', () => {
  async function twoVehiclesOutOfIdOrder(): Promise<[string, string]> {
    const ids = [await seedVehicle('Honda'), await seedVehicle('Toyota')].sort();
    return [ids[1] as string, ids[0] as string];
  }

  const centsByVehicle = (termId: string) =>
    Object.fromEntries(autoExpensesForTerm(termId).map((r) => [r.vehicle_id, r.expense_amount]));

  test('on create, the first chosen vehicle takes the odd cent even when its id sorts last', async () => {
    const [first, second] = await twoVehiclesOutOfIdOrder();
    const { termId } = await createPolicy([first, second], 100.01);

    expect(centsByVehicle(termId)).toEqual({ [first]: 5001, [second]: 5000 });
  });

  test('on adding a term, the first chosen vehicle takes the odd cent even when its id sorts last', async () => {
    const [first, second] = await twoVehiclesOutOfIdOrder();
    const { policyId } = await createPolicy([first], 10);

    const res = await ctx.authed('POST', `/api/v1/insurance/${policyId}/terms`, {
      startDate: '2025-01-01T00:00:00.000Z',
      endDate: '2026-01-01T00:00:00.000Z',
      totalCost: 100.01,
      vehicleCoverage: { vehicleIds: [first, second] },
    });
    const body = await json<DataEnvelope<{ terms: { id: string }[] }>>(res);
    expect(res.status, JSON.stringify(body)).toBeLessThan(300);
    const added = body.data.terms.find((t) => autoExpensesForTerm(t.id).length === 2);

    expect(centsByVehicle(added?.id ?? '')).toEqual({ [first]: 5001, [second]: 5000 });
  });

  test('on update, re-choosing the vehicles in a new order with a new cost moves the odd cent', async () => {
    const [first, second] = await twoVehiclesOutOfIdOrder();
    const { policyId, termId } = await createPolicy([second, first], 100.01);
    expect(centsByVehicle(termId)).toEqual({ [second]: 5001, [first]: 5000 });

    const res = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/terms/${termId}`, {
      totalCost: 200.01,
      vehicleCoverage: { vehicleIds: [first, second] },
    });
    expect(res.status, await res.text()).toBeLessThan(300);

    expect(centsByVehicle(termId)).toEqual({ [first]: 10001, [second]: 10000 });
  });

  test('on update, reordering the same vehicles alone moves the odd cent', async () => {
    const [first, second] = await twoVehiclesOutOfIdOrder();
    const { policyId, termId } = await createPolicy([second, first], 100.01);
    expect(centsByVehicle(termId)).toEqual({ [second]: 5001, [first]: 5000 });

    const res = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/terms/${termId}`, {
      vehicleCoverage: { vehicleIds: [first, second] },
    });
    expect(res.status, await res.text()).toBeLessThan(300);

    expect(centsByVehicle(termId)).toEqual({ [first]: 5001, [second]: 5000 });
  });

  test('recalculating an over-counted monthly premium keeps the odd cent on the first chosen vehicle', async () => {
    const [first, second] = await twoVehiclesOutOfIdOrder();
    const { termId } = await createMonthlyPolicy(
      [first, second],
      100.01,
      '2024-01-01T12:00:00.000Z',
      '2024-12-01T12:00:00.000Z'
    );
    const firstRow = autoExpensesForTerm(termId).find((r) => r.vehicle_id === first);
    ctx.sqlite
      .query('UPDATE expenses SET expense_amount = 60006, group_total = 120012 WHERE source_id = ?')
      .run(termId);
    ctx.sqlite
      .query('UPDATE expenses SET rowid = rowid + 1000000 WHERE id = ?')
      .run(firstRow?.id ?? '');

    expect(await recalculateOvercountedMonthlyPremiums()).toBe(1);

    expect(centsByVehicle(termId)).toEqual({ [first]: 55006, [second]: 55005 });
  });

  test('on update, an unchanged order keeps the premium rows as they are', async () => {
    const [first, second] = await twoVehiclesOutOfIdOrder();
    const { policyId, termId } = await createPolicy([first, second], 100.01);
    const before = autoExpensesForTerm(termId).map((r) => r.id);

    const res = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/terms/${termId}`, {
      vehicleCoverage: { vehicleIds: [first, second] },
    });
    expect(res.status, await res.text()).toBeLessThan(300);

    expect(autoExpensesForTerm(termId).map((r) => r.id)).toEqual(before);
  });
});
