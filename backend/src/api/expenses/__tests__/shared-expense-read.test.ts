import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type PaginatedEnvelope,
  type RequestFn,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;
let asB: RequestFn;
let bEmail: string;

beforeEach(async () => {
  ctx = await createTestApp();
  const b = await createInvitee(ctx, 'expr-invitee', 'Reader B');
  bEmail = b.email;
  asB = b.request;
});
afterEach(() => ctx.close());

interface ExpenseRow {
  id: string;
  vehicleId: string;
  expenseAmount: number;
}

async function shareWithExpense(level: 'viewer' | 'editor'): Promise<[string, string]> {
  const vehicleId = await seedVehicle(ctx, { make: 'Shared', model: 'Car', year: 2021 });
  const exp = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'maintenance',
    expenseAmount: 75,
    date: '2024-06-01T00:00:00.000Z',
  });
  const expenseId = (await json<DataEnvelope<{ id: string }>>(exp)).data.id;
  const invite = await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: bEmail, level });
  const inviteId = (await json<DataEnvelope<{ id: string }>>(invite)).data.id;
  expect((await asB('POST', `/api/v1/shares/${inviteId}/accept`)).status).toBe(200);
  return [vehicleId, expenseId];
}

describe('shared expense reads per vehicle', () => {
  test('an accepted VIEWER reads the shared vehicle list / single / summary (owner-stamped rows)', async () => {
    const [vehicleId, expenseId] = await shareWithExpense('viewer');

    const list = await json<PaginatedEnvelope<ExpenseRow>>(
      await asB('GET', `/api/v1/expenses?vehicleId=${vehicleId}`)
    );
    expect(list.pagination.totalCount).toBe(1);
    expect(list.data[0]?.id).toBe(expenseId);
    expect(list.data[0]?.expenseAmount).toBe(75);

    const single = await asB('GET', `/api/v1/expenses/${expenseId}`);
    const singleBody = await json<DataEnvelope<ExpenseRow>>(single);
    expect(single.status).toBe(200);
    expect(singleBody.data.id).toBe(expenseId);

    const summary = await asB('GET', `/api/v1/expenses/summary?vehicleId=${vehicleId}`);
    const summaryBody =
      await json<DataEnvelope<{ totalAmount: number; expenseCount: number }>>(summary);
    expect(summary.status).toBe(200);
    expect(summaryBody.data.expenseCount).toBe(1);
    expect(summaryBody.data.totalAmount).toBe(75);
  });

  test('CROSS-FLEET reads stay acting-user-owned: B all-vehicles list/summary exclude the shared vehicle (no double-count)', async () => {
    const [vehicleId] = await shareWithExpense('editor');

    const list = await json<PaginatedEnvelope<ExpenseRow>>(await asB('GET', '/api/v1/expenses'));
    expect(list.data.find((e) => e.vehicleId === vehicleId)).toBeUndefined();
    expect(list.pagination.totalCount).toBe(0);

    const summary = await json<DataEnvelope<{ totalAmount: number; expenseCount: number }>>(
      await asB('GET', '/api/v1/expenses/summary')
    );
    expect(summary.data.expenseCount).toBe(0);
    expect(summary.data.totalAmount).toBe(0);

    const ownerSummary = await json<DataEnvelope<{ totalAmount: number; expenseCount: number }>>(
      await ctx.authed('GET', '/api/v1/expenses/summary')
    );
    expect(ownerSummary.data.expenseCount).toBe(1);
    expect(ownerSummary.data.totalAmount).toBe(75);
  });

  test('a STRANGER (no share) is denied every per-vehicle read with the existence-hiding 404', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Private', model: 'Car', year: 2021 });
    const exp = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 10,
      date: '2024-06-02T00:00:00.000Z',
    });
    const expenseId = (await json<DataEnvelope<{ id: string }>>(exp)).data.id;

    expect((await asB('GET', `/api/v1/expenses?vehicleId=${vehicleId}`)).status).toBe(404);
    expect((await asB('GET', `/api/v1/expenses/${expenseId}`)).status).toBe(404);
    expect((await asB('GET', `/api/v1/expenses/summary?vehicleId=${vehicleId}`)).status).toBe(404);
  });

  test('a PENDING (un-accepted) invite grants no read — the vehicle reads still 404 until accepted', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Pending', model: 'Car', year: 2021 });
    const exp = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 5,
      date: '2024-06-03T00:00:00.000Z',
    });
    const expenseId = (await json<DataEnvelope<{ id: string }>>(exp)).data.id;
    await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: bEmail, level: 'viewer' });

    expect((await asB('GET', `/api/v1/expenses?vehicleId=${vehicleId}`)).status).toBe(404);
    expect((await asB('GET', `/api/v1/expenses/${expenseId}`)).status).toBe(404);
  });

  test('the owner reading their own vehicle is unchanged', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Owned', model: 'Car', year: 2022 });
    await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 33,
      date: '2024-06-04T00:00:00.000Z',
    });
    const list = await json<PaginatedEnvelope<ExpenseRow>>(
      await ctx.authed('GET', `/api/v1/expenses?vehicleId=${vehicleId}`)
    );
    expect(list.pagination.totalCount).toBe(1);
    expect(list.data[0]?.expenseAmount).toBe(33);
  });
});

describe('shared per-vehicle CSV export', () => {
  test('an accepted VIEWER exports the shared vehicle CSV (owner-stamped rows + the OWNER vehicle name)', async () => {
    const [vehicleId] = await shareWithExpense('viewer');

    const res = await asB('GET', `/api/v1/expenses/export?vehicleId=${vehicleId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const csv = await res.text();
    expect(csv).toContain('maintenance');
    expect(csv).toContain('75');
    expect(csv).toContain('2021 Shared Car');
    expect(csv).not.toContain('Unknown Vehicle');
  });

  test('a STRANGER (no share) is denied the per-vehicle export (existence-hiding 404)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Private', model: 'Car', year: 2021 });
    await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 10,
      date: '2024-06-02T00:00:00.000Z',
    });
    expect((await asB('GET', `/api/v1/expenses/export?vehicleId=${vehicleId}`)).status).toBe(404);
  });

  test('the CROSS-FLEET export (no vehicleId) stays acting-user-scoped — B export excludes the shared vehicle', async () => {
    await shareWithExpense('editor');
    const res = await asB('GET', '/api/v1/expenses/export');
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).not.toContain('2021 Shared Car');
    expect(csv).not.toContain('maintenance');

    const ownerCsv = await (await ctx.authed('GET', '/api/v1/expenses/export')).text();
    expect(ownerCsv).toContain('2021 Shared Car');
  });

  test('the owner exporting their OWN vehicle is unchanged (owner === acting)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Owned', model: 'Car', year: 2022 });
    await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 12,
      date: '2024-06-03T00:00:00.000Z',
    });
    const res = await ctx.authed('GET', `/api/v1/expenses/export?vehicleId=${vehicleId}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('2022 Owned Car');
  });
});
