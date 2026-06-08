/**
 * Characterizes what `DELETE /api/v1/expenses/:id` does to a SPLIT sibling.
 *
 * Both UI delete paths for a split — the ExpensesTable list row and the
 * non-insurance branch of ExpenseForm.handleDelete — call
 * expenseApi.deleteExpense(child.id), which hits this single-row route. The
 * dialogs imply the whole split goes away ("removes the entire split — every
 * vehicle's portion"), and the intended group-delete route /split/:id deletes
 * every sibling (and cleans their photos). This test pins the actual behavior so
 * the fix (route the split delete through the group endpoint) has a failing-first
 * proof and a regression guard.
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules, so keep static
 * imports to the harness + bun:test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type DataEnvelope, json, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function seedVehicle(make: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', { make, model: 'Test', year: 2021 });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

interface SplitEnvelope {
  data: { siblings: Array<{ id: string; groupId: string; amount: number }>; groupId: string };
}

async function createEvenSplit(vehicleIds: string[], total: number): Promise<SplitEnvelope['data']> {
  const res = await ctx.authed('POST', '/api/v1/expenses/split', {
    splitConfig: { method: 'even', vehicleIds },
    category: 'maintenance',
    date: '2024-02-01',
    description: 'Deluxe car wash - split',
    totalAmount: total,
  });
  const body = await json<SplitEnvelope>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data;
}

function rowCountForGroup(groupId: string): number {
  const row = ctx.sqlite
    .query('SELECT COUNT(*) AS n FROM expenses WHERE group_id = ?')
    .get(groupId) as { n: number };
  return row.n;
}

describe('deleting a split sibling via DELETE /:id', () => {
  test('single-row delete leaves the rest of the split ORPHANED (current behavior)', async () => {
    const v1 = await seedVehicle('Honda');
    const v2 = await seedVehicle('Toyota');
    const group = await createEvenSplit([v1, v2], 30);
    expect(group.siblings).toHaveLength(2);
    expect(rowCountForGroup(group.groupId)).toBe(2);

    // What the ExpensesTable row delete (and the non-insurance ExpenseForm delete)
    // actually call: a single-row delete on children[0].
    const del = await ctx.authed('DELETE', `/api/v1/expenses/${group.siblings[0]!.id}`);
    expect(del.status).toBe(200);

    // The OTHER sibling survives — the group is now a broken partial split whose
    // remaining rows no longer sum to groupTotal. This is the bug the dialog hides.
    expect(rowCountForGroup(group.groupId)).toBe(1);
  });

  test('the group-delete route /split/:id removes EVERY sibling (the intended behavior)', async () => {
    const v1 = await seedVehicle('Honda');
    const v2 = await seedVehicle('Toyota');
    const group = await createEvenSplit([v1, v2], 30);
    expect(rowCountForGroup(group.groupId)).toBe(2);

    // Deleting via the group endpoint (passing ANY member's id is how the UI calls
    // it) clears the whole group — what "removes the entire split" should mean.
    const del = await ctx.authed('DELETE', `/api/v1/expenses/split/${group.groupId}`);
    expect(del.status).toBe(200);
    expect(rowCountForGroup(group.groupId)).toBe(0);
  });
});
