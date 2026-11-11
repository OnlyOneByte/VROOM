/**
 * Deleting one vehicle of a materialized split group must leave the survivors' legs summing to the
 * group total.
 *
 * A split expense is stored as one row per vehicle: each row carries its own `expense_amount` (its
 * leg) plus `group_total`, the pre-split total repeated on every sibling. "The legs sum to
 * group_total" is the invariant the split create/update paths enforce.
 *
 * The vehicle-delete route prunes the reminder split-config blobs (not FK-managed) but the FK cascade
 * only removes the deleted vehicle's own sibling row, so the survivors used to keep a `group_total`
 * from a split that no longer exists. That stale header is then amplified into money: an even or
 * percentage edit with no explicit total re-divides `group_total` across the surviving legs, so the
 * survivor's recorded cost silently grows to the whole original amount.
 *
 * The invariant pinned here: after a vehicle delete, every surviving split group's `group_total`
 * equals the sum of its surviving legs, and a later edit re-divides only that honest total.
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules — keep static imports to the
 * harness + bun:test.
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

interface VehicleResponse {
  id: string;
}
interface SplitCreateResponse {
  groupId: string;
}

async function createVehicle(nickname: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Honda',
    model: 'Civic',
    year: 2020,
    nickname,
  });
  expect(res.status).toBe(201);
  return (await json<DataEnvelope<VehicleResponse>>(res)).data.id;
}

async function createEvenSplit(vehicleIds: string[], totalAmount: number): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/expenses/split', {
    splitConfig: { method: 'even', vehicleIds },
    totalAmount,
    category: 'maintenance',
    date: '2026-03-01',
    description: 'Four new tyres',
  });
  expect(res.status).toBe(201);
  return (await json<DataEnvelope<SplitCreateResponse>>(res)).data.groupId;
}

/** The surviving sibling rows of a group, in CENTS, straight from the table. */
function legs(
  groupId: string
): Array<{ vehicle_id: string; expense_amount: number; group_total: number }> {
  return ctx.sqlite
    .query(
      `SELECT vehicle_id, expense_amount, group_total FROM expenses
       WHERE group_id = ? ORDER BY vehicle_id`
    )
    .all(groupId) as Array<{ vehicle_id: string; expense_amount: number; group_total: number }>;
}

describe('vehicle delete and materialized split groups', () => {
  test('the surviving leg of a two-way split keeps a group total that matches it', async () => {
    const [v1, v2] = [await createVehicle('Keeper'), await createVehicle('Doomed')];
    const groupId = await createEvenSplit([v1, v2], 100);

    expect(legs(groupId)).toEqual(
      [
        { vehicle_id: v1, expense_amount: 5000, group_total: 10000 },
        { vehicle_id: v2, expense_amount: 5000, group_total: 10000 },
      ].sort((a, b) => a.vehicle_id.localeCompare(b.vehicle_id))
    );

    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${v2}`);
    expect(del.status).toBe(200);

    const surviving = legs(groupId);
    expect(surviving).toHaveLength(1);
    // The honest result: the survivor incurred $50 and the group is now a $50 group.
    expect(surviving[0]).toEqual({ vehicle_id: v1, expense_amount: 5000, group_total: 5000 });
  });

  test('a later even edit re-divides the surviving total, not the pre-delete one', async () => {
    const [v1, v2] = [await createVehicle('Keeper'), await createVehicle('Doomed')];
    const groupId = await createEvenSplit([v1, v2], 100);

    expect((await ctx.authed('DELETE', `/api/v1/vehicles/${v2}`)).status).toBe(200);

    // No `totalAmount`: the update path falls back to the stored group total, which is exactly where a
    // stale header turns into a wrong amount.
    const edit = await ctx.authed('PUT', `/api/v1/expenses/split/${groupId}`, {
      splitConfig: { method: 'even', vehicleIds: [v1] },
    });
    expect(edit.status).toBe(200);

    expect(legs(groupId)).toEqual([{ vehicle_id: v1, expense_amount: 5000, group_total: 5000 }]);
  });

  test('a three-way split keeps the two survivors summing to the new total', async () => {
    const v1 = await createVehicle('A');
    const v2 = await createVehicle('B');
    const v3 = await createVehicle('C');
    const groupId = await createEvenSplit([v1, v2, v3], 90);

    expect((await ctx.authed('DELETE', `/api/v1/vehicles/${v3}`)).status).toBe(200);

    const surviving = legs(groupId);
    expect(surviving).toHaveLength(2);
    const sum = surviving.reduce((acc, row) => acc + row.expense_amount, 0);
    expect(sum).toBe(6000);
    for (const row of surviving) {
      expect(row.group_total).toBe(sum);
    }
  });

  test('a split group untouched by the delete keeps its original total', async () => {
    const v1 = await createVehicle('A');
    const v2 = await createVehicle('B');
    const v3 = await createVehicle('C');
    const untouched = await createEvenSplit([v1, v2], 100);
    const affected = await createEvenSplit([v1, v3], 60);

    expect((await ctx.authed('DELETE', `/api/v1/vehicles/${v3}`)).status).toBe(200);

    for (const row of legs(untouched)) {
      expect(row.expense_amount).toBe(5000);
      expect(row.group_total).toBe(10000);
    }
    expect(legs(affected)).toEqual([{ vehicle_id: v1, expense_amount: 3000, group_total: 3000 }]);
  });
});
