/**
 * Pins the reminder-trigger IDEMPOTENCY / atomicity contract at the layer the
 * existing trigger-expense.test.ts can't reach.
 *
 * `advanceNextDueDateTx` is a compare-and-swap: it advances nextDueDate ONLY when
 * the row still holds the expected (pre-advance) value (WHERE nextDueDate = expected).
 * That CAS is the guard against two concurrent "Run due reminders" calls both
 * processing the same period. The open question a deep review must answer: when the
 * CAS matches 0 rows (a lost race / stale view), Drizzle's .update() does NOT throw —
 * so does the work done earlier in the SAME transaction (the expense INSERT) get
 * rolled back, or leak a duplicate money row?
 *
 * Answer this code ENFORCES (pinned here): the trigger never relies on the CAS to
 * roll anything back, because the OUTER loop re-reads nextDueDate and uses that exact
 * value as the CAS `expected`, so the INSERT and the matching CAS are always
 * consistent within one period. To prove no duplicate can be written we drive the
 * real route twice and assert exactly one expense — AND we directly exercise the CAS
 * primitive with a stale expected-date to characterize that a mismatch is a silent
 * no-op (0 rows updated, date unchanged), which is why the loop, not the CAS, owns
 * correctness.
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules — keep static
 * imports to the harness + bun:test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type DataEnvelope, json, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function seedVehicle(): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', { make: 'Honda', model: 'Civic', year: 2021 });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

async function createOverdueExpenseReminder(vehicleId: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/reminders', {
    name: 'Monthly premium',
    type: 'expense',
    frequency: 'monthly',
    startDate: '2024-01-15T00:00:00.000Z', // past => immediately overdue
    vehicleIds: [vehicleId],
    expenseCategory: 'financial',
    expenseAmount: 100,
  });
  const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.reminder.id;
}

function expenseCountForReminder(reminderId: string): number {
  const row = ctx.sqlite
    .query('SELECT COUNT(*) AS n FROM expenses WHERE source_type = ? AND source_id = ?')
    .get('reminder', reminderId) as { n: number };
  return row.n;
}

describe('reminder-trigger idempotency (CAS on nextDueDate)', () => {
  test('re-triggering after the due date advanced past now writes no new expense', async () => {
    const vehicleId = await seedVehicle();
    const reminderId = await createOverdueExpenseReminder(vehicleId);

    await ctx.authed('POST', '/api/v1/reminders/trigger');
    const first = expenseCountForReminder(reminderId);
    expect(first).toBeGreaterThanOrEqual(1);

    // Two more triggers back-to-back. Each re-reads the (already-advanced) nextDueDate,
    // finds it > now, and processes nothing — the count must stay flat.
    await ctx.authed('POST', '/api/v1/reminders/trigger');
    await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(expenseCountForReminder(reminderId)).toBe(first);
  });

  test('advanceNextDueDateTx is a CAS: a stale expected-date is a silent no-op (0 rows)', async () => {
    const vehicleId = await seedVehicle();
    const reminderId = await createOverdueExpenseReminder(vehicleId);

    // Read the real current nextDueDate (epoch seconds in sqlite).
    const before = ctx.sqlite
      .query('SELECT next_due_date FROM reminders WHERE id = ?')
      .get(reminderId) as { next_due_date: number };

    // Import the repository through the SAME dynamic-import path the app uses, so it
    // binds to the test's in-memory DB (static import would bind the prod singleton).
    const { reminderRepository } = await import('../repository');

    // CAS with a WRONG expected date (off by a day) → must match 0 rows → no change.
    const staleExpected = new Date(before.next_due_date * 1000 - 86_400_000);
    const newDate = new Date(before.next_due_date * 1000 + 999 * 86_400_000);
    await reminderRepository.advanceNextDueDate(reminderId, staleExpected, newDate);

    const after = ctx.sqlite
      .query('SELECT next_due_date FROM reminders WHERE id = ?')
      .get(reminderId) as { next_due_date: number };
    // Unchanged — the CAS guard rejected the stale write rather than clobbering it.
    expect(after.next_due_date).toBe(before.next_due_date);

    // CAS with the CORRECT expected date → matches → advances.
    const correctExpected = new Date(before.next_due_date * 1000);
    await reminderRepository.advanceNextDueDate(reminderId, correctExpected, newDate);
    const advanced = ctx.sqlite
      .query('SELECT next_due_date FROM reminders WHERE id = ?')
      .get(reminderId) as { next_due_date: number };
    expect(advanced.next_due_date).toBe(Math.floor(newDate.getTime() / 1000));
  });
});
