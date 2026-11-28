import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee, type Invitee } from '../../../test-helpers/invitee';

let ctx: TestApp;
let other: Invitee;

beforeEach(async () => {
  ctx = await createTestApp();
  other = await createInvitee(ctx, 'split-other', 'Other');
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

function car(id: string, userId: string) {
  ctx.sqlite.run(
    "INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, 'Kia', 'Rio', 2020)",
    [id, userId]
  );
}

function leg(id: string, vehicleId: string, userId: string) {
  ctx.sqlite.run(
    `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, missed_fillup, group_id, group_total, split_method)
     VALUES (?, ?, ?, 'maintenance', 1600000000, 5000, 0, 'shared-group', 10000, 'even')`,
    [id, vehicleId, userId]
  );
}

type Split = { siblings: Array<{ id: string }> };

describe('split expense views read one owner’s records', () => {
  beforeEach(() => {
    car('mine-a', ctx.user.id);
    car('mine-b', ctx.user.id);
    car('theirs', other.id);
    leg('mine-1', 'mine-a', ctx.user.id);
    leg('mine-2', 'mine-b', ctx.user.id);
    leg('theirs-1', 'theirs', other.id);
  });

  test('each owner sees only their own legs', async () => {
    const mineRes = await ctx.authed('GET', '/api/v1/expenses/split/shared-group');
    const mine = await json<DataEnvelope<Split>>(mineRes);
    expect(mineRes.status, JSON.stringify(mine)).toBe(200);
    expect(mine.data.siblings.map((s) => s.id).sort()).toEqual(['mine-1', 'mine-2']);

    const theirsRes = await other.request('GET', '/api/v1/expenses/split/shared-group');
    const theirs = await json<DataEnvelope<Split>>(theirsRes);
    expect(theirsRes.status, JSON.stringify(theirs)).toBe(200);
    expect(theirs.data.siblings.map((s) => s.id)).toEqual(['theirs-1']);
  });

  test('an edit changes only the editor’s own legs', async () => {
    const res = await ctx.authed('PUT', '/api/v1/expenses/split/shared-group', {
      splitConfig: { method: 'even', vehicleIds: ['mine-a', 'mine-b'] },
      totalAmount: 80,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const theirs = ctx.sqlite
      .query("SELECT expense_amount, group_id FROM expenses WHERE id = 'theirs-1'")
      .get() as { expense_amount: number; group_id: string };
    expect(theirs).toEqual({ expense_amount: 5000, group_id: 'shared-group' });
    const mine = ctx.sqlite
      .query("SELECT expense_amount FROM expenses WHERE id IN ('mine-1', 'mine-2')")
      .all();
    expect(mine).toEqual([{ expense_amount: 4000 }, { expense_amount: 4000 }]);
  });

  test('a delete removes only the deleter’s own legs', async () => {
    const res = await other.request('DELETE', '/api/v1/expenses/split/shared-group');
    expect(res.status, await res.clone().text()).toBe(200);
    const left = ctx.sqlite
      .query("SELECT id FROM expenses WHERE group_id = 'shared-group' ORDER BY id")
      .all();
    expect(left).toEqual([{ id: 'mine-1' }, { id: 'mine-2' }]);
  });

  test('updating one leg does not take its version from another owner’s leg', async () => {
    ctx.sqlite.run("UPDATE expenses SET updated_at = 4102444800 WHERE id = 'theirs-1'");
    const res = await ctx.authed('PUT', '/api/v1/expenses/mine-1', { description: 'Oil' });
    expect(res.status, await res.clone().text()).toBe(200);
    const mine = ctx.sqlite.query("SELECT updated_at FROM expenses WHERE id = 'mine-1'").get() as {
      updated_at: number;
    };
    expect(mine.updated_at).toBeLessThan(4102444800);
  });

  test('someone with no legs gets nothing when the owners are mixed', async () => {
    const third = await createInvitee(ctx, 'split-third', 'Third');
    const res = await third.request('GET', '/api/v1/expenses/split/shared-group');
    expect(res.status).toBe(404);
  });
});
