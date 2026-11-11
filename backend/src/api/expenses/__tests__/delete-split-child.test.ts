import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, json, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle as seedVehicleShared } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

const seedVehicle = (make: string): Promise<string> =>
  seedVehicleShared(ctx, { make, model: 'Test', year: 2021 });

interface SplitEnvelope {
  data: { siblings: Array<{ id: string; groupId: string; amount: number }>; groupId: string };
}

async function createEvenSplit(
  vehicleIds: string[],
  total: number
): Promise<SplitEnvelope['data']> {
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

    const del = await ctx.authed('DELETE', `/api/v1/expenses/${group.siblings[0].id}`);
    expect(del.status).toBe(200);

    expect(rowCountForGroup(group.groupId)).toBe(1);
  });

  test('the group-delete route /split/:id removes EVERY sibling (the intended behavior)', async () => {
    const v1 = await seedVehicle('Honda');
    const v2 = await seedVehicle('Toyota');
    const group = await createEvenSplit([v1, v2], 30);
    expect(rowCountForGroup(group.groupId)).toBe(2);

    const del = await ctx.authed('DELETE', `/api/v1/expenses/split/${group.groupId}`);
    expect(del.status).toBe(200);
    expect(rowCountForGroup(group.groupId)).toBe(0);
  });
});
