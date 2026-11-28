import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee, type Invitee } from '../../../test-helpers/invitee';
import { overrideOn, seedCar, shareCar } from '../../../test-helpers/members';

let ctx: TestApp;
let viewer: Invitee;

const CAR = 'sev-car';
const JUNE = 1717200000;
const RUNNING = 'sev-running';
const MANUAL = 'sev-manual';
const LINKED = 'sev-linked';

function expense(
  id: string,
  category: string,
  cents: number,
  description: string,
  sourceType: string | null = null
): void {
  ctx.sqlite.run(
    'INSERT INTO expenses (id, vehicle_id, user_id, category, expense_amount, date, description, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, CAR, ctx.user.id, category, cents, JUNE, description, sourceType]
  );
}

beforeEach(async () => {
  ctx = await createTestApp();
  await seedCar(ctx, CAR);
  expense(RUNNING, 'maintenance', 8000, 'Oil change');
  expense(MANUAL, 'financial', 5000, 'Paperwork fee');
  expense(LINKED, 'financial', 40000, 'Loan payment', 'financing');
  viewer = await createInvitee(ctx, 'sev-viewer');
  await shareCar(ctx, CAR, viewer, 'viewer');
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function data<T>(request: RequestFn, path: string): Promise<T> {
  const res = await request('GET', path);
  expect(res.status, path).toBe(200);
  return (await json<DataEnvelope<T>>(res)).data;
}

async function listedIds(request: RequestFn, query = ''): Promise<string[]> {
  const rows = await data<Array<{ id: string }>>(
    request,
    `/api/v1/expenses?vehicleId=${CAR}${query}`
  );
  return rows.map((r) => r.id).sort();
}

describe('expenses of a shared car follow the share settings everywhere', () => {
  test('a viewer without financial access sees only the running costs', async () => {
    expect(await listedIds(viewer.request)).toEqual([RUNNING]);
    expect(await listedIds(viewer.request, '&search=Paperwork')).toEqual([]);

    const summary = await data<{ totalAmount: number; expenseCount: number }>(
      viewer.request,
      `/api/v1/expenses/summary?vehicleId=${CAR}`
    );
    expect(summary.totalAmount).toBe(80);
    expect(summary.expenseCount).toBe(1);

    const months = await data<Array<{ amount: number }>>(
      viewer.request,
      `/api/v1/expenses/monthly-totals?vehicleId=${CAR}`
    );
    expect(months.reduce((sum, m) => sum + m.amount, 0)).toBe(80);

    const csv = await viewer.request('GET', `/api/v1/expenses/export?vehicleId=${CAR}`);
    expect(csv.status).toBe(200);
    const text = await csv.text();
    expect(text).toContain('Oil change');
    expect(text).not.toContain('Paperwork fee');
    expect(text).not.toContain('Loan payment');

    const tco = await data<{ totalCost: number }>(
      viewer.request,
      `/api/v1/analytics/vehicle-tco?vehicleId=${CAR}`
    );
    expect(tco.totalCost).toBe(80);
  });

  test('a viewer without financial access cannot open a financial expense or its photos', async () => {
    for (const id of [MANUAL, LINKED]) {
      expect((await viewer.request('GET', `/api/v1/expenses/${id}`)).status, id).toBe(404);
      expect((await viewer.request('GET', `/api/v1/photos/expense/${id}`)).status, id).toBe(404);
    }
    expect((await viewer.request('GET', `/api/v1/expenses/${RUNNING}`)).status).toBe(200);
  });

  test('a viewer the owner lets see financials gets every row', async () => {
    await overrideOn(ctx, CAR, viewer, 'vehicle.financing.read', 'allow');
    await overrideOn(ctx, CAR, viewer, 'vehicle.insurance.read', 'allow');

    expect(await listedIds(viewer.request)).toEqual([LINKED, MANUAL, RUNNING].sort());
    const summary = await data<{ totalAmount: number }>(
      viewer.request,
      `/api/v1/expenses/summary?vehicleId=${CAR}`
    );
    expect(summary.totalAmount).toBe(80 + 50 + 400);
    expect((await viewer.request('GET', `/api/v1/expenses/${MANUAL}`)).status).toBe(200);
  });

  test('the owner sees every row of their own car', async () => {
    expect(await listedIds(ctx.authed)).toEqual([LINKED, MANUAL, RUNNING].sort());
  });
});

describe('other views of a shared car follow the same settings', () => {
  test('the fuel-advanced cost breakdown leaves out what the share hides', async () => {
    const res = await viewer.request(
      'GET',
      `/api/v1/analytics/fuel-advanced?vehicleId=${CAR}&startDate=1704067200&endDate=1735603200`
    );
    expect(res.status).toBe(200);
    const body = await json<DataEnvelope<{ monthlyCostHeatmap: Record<string, unknown>[] }>>(res);
    const months = body.data.monthlyCostHeatmap;
    expect(months.some((row) => row.maintenance === 80)).toBe(true);
    expect(months.every((row) => !row.financial)).toBe(true);
  });

  test("a reminder's expenses leave out what the share hides", async () => {
    ctx.sqlite.run(
      "INSERT INTO reminders (id, user_id, name, type, frequency, start_date, expense_category, expense_amount) VALUES ('sev-rem', ?, 'Monthly', 'expense', 'monthly', ?, 'financial', 5000)",
      [ctx.user.id, JUNE]
    );
    ctx.sqlite.run(
      "INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES ('sev-rem', ?)",
      [CAR]
    );
    ctx.sqlite.run(
      "UPDATE expenses SET source_type = 'reminder', source_id = 'sev-rem' WHERE id = ?",
      [MANUAL]
    );

    expect(await data<unknown[]>(viewer.request, '/api/v1/reminders/sev-rem/expenses')).toEqual([]);
    const own = await data<Array<{ id: string }>>(ctx.authed, '/api/v1/reminders/sev-rem/expenses');
    expect(own.map((e) => e.id)).toEqual([MANUAL]);
  });

  test('an editor without financial access cannot change or delete what they cannot see', async () => {
    const editor = await createInvitee(ctx, 'sev-editor');
    await shareCar(ctx, CAR, editor, 'editor');
    ctx.sqlite.run('UPDATE expenses SET updated_at = ? WHERE id = ?', [JUNE, MANUAL]);

    const put = await editor.request('PUT', `/api/v1/expenses/${MANUAL}`, {
      description: 'Changed',
      expectedUpdatedAt: new Date(JUNE * 1000).toISOString(),
    });
    expect(put.status).toBe(404);
    expect(
      (await editor.request('DELETE', `/api/v1/expenses/${MANUAL}`)).status
    ).toBeGreaterThanOrEqual(400);
    const row = ctx.sqlite.query('SELECT description FROM expenses WHERE id = ?').get(MANUAL) as {
      description: string;
    } | null;
    expect(row?.description).toBe('Paperwork fee');
  });
});
