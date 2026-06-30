/**
 * recurring-expenses T3 (C104): cascade-safe delete (R4, D2).
 *
 * A 'expense'-type reminder auto-materializes real expense rows (sourceType:'reminder',
 * sourceId:reminder.id). Per D2 (ratified C94), deleting the reminder must NOT delete that
 * history — it severs the link via clearSource('reminder', id, userId): the expense rows STAY,
 * their sourceType/sourceId are nulled, and no future materialization occurs (the reminder is
 * gone). This pins that contract through the real route→trigger→delete stack. The clearSource
 * primitive itself was certified C101 (userId-scoped, keeps rows); this pins the WIRING.
 *
 * Mirrors trigger-expense.test.ts (createTestApp; static imports to the harness + bun:test).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function createOverdueExpenseReminder(vehicleId: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/reminders', {
    name: 'Monthly insurance premium',
    type: 'expense',
    frequency: 'monthly',
    startDate: '2024-01-15T00:00:00.000Z',
    vehicleIds: [vehicleId],
    expenseCategory: 'financial',
    expenseAmount: 125.5,
  });
  const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.reminder.id;
}

interface ExpenseRow {
  id: string;
  expense_amount: number;
  source_type: string | null;
  source_id: string | null;
}

/** All expense rows that WERE materialized by this reminder (by id, regardless of current source). */
function expensesByIds(ids: string[]): ExpenseRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return ctx.sqlite
    .query(
      `SELECT id, expense_amount, source_type, source_id FROM expenses WHERE id IN (${placeholders})`
    )
    .all(...ids) as ExpenseRow[];
}

function materializedExpenseIds(reminderId: string): string[] {
  const rows = ctx.sqlite
    .query('SELECT id FROM expenses WHERE source_type = ? AND source_id = ?')
    .all('reminder', reminderId) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

describe('reminder delete cascade (recurring-expenses T3 — keep history, sever link)', () => {
  test('deleting an expense reminder KEEPS its materialized expenses but NULLs their source link', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const reminderId = await createOverdueExpenseReminder(vehicleId);

    // Materialize the expense row(s) via the real trigger path.
    const trigRes = await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(trigRes.status).toBe(200);
    const ids = materializedExpenseIds(reminderId);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    const countBefore = ids.length;

    // Delete the reminder.
    const delRes = await ctx.authed('DELETE', `/api/v1/reminders/${reminderId}`);
    expect(delRes.status).toBe(200);

    // The reminder is gone...
    const remRow = ctx.sqlite.query('SELECT id FROM reminders WHERE id = ?').get(reminderId) as {
      id: string;
    } | null;
    expect(remRow).toBeNull();

    // ...but the expense rows REMAIN (history preserved), same count, with the source link NULLED.
    const rows = expensesByIds(ids);
    expect(rows.length).toBe(countBefore);
    for (const r of rows) {
      expect(r.source_type).toBeNull();
      expect(r.source_id).toBeNull();
      expect(r.expense_amount).toBe(12550); // $125.50 → 12550 cents (money-cents-migration)
    }

    // And nothing is still linked to the (now-deleted) reminder.
    expect(materializedExpenseIds(reminderId)).toHaveLength(0);
  });

  test('deleting a non-expense (notification) reminder is a clean no-op on expenses', async () => {
    // A notification reminder materializes NO expense rows; clearSource matches 0, delete succeeds.
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const res = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Oil change',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-01-15T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    const reminderId = body.data.reminder.id;

    const delRes = await ctx.authed('DELETE', `/api/v1/reminders/${reminderId}`);
    expect(delRes.status).toBe(200);

    // No expenses existed for it; clearSource matched 0 rows; delete succeeded.
    expect(materializedExpenseIds(reminderId)).toHaveLength(0);
  });
});
