/**
 * C151 (recurring-expenses engine hardening — completes the bug #13 fix): the MAIN catch-up loop in
 * processReminder had no non-progress guard. The #13 fix guarded advanceCustom (bad UNIT) +
 * fastForwardPastNow (non-progress backstop), but left two reachable holes in the main loop:
 *   (a) a corrupt top-level `frequency` (e.g. 'monthy') hit computeNextDueDate's switch with NO
 *       default → returned the date UNCHANGED;
 *   (b) `intervalValue = 0` (frequency='custom') → `?? 1` doesn't replace 0 → setDate(+0)/setMonth(+0)
 *       is a no-op.
 * Either way `nextDue` never advanced, so the `while (nextDue <= now)` loop materialized up to
 * maxCatchUp (12) DUPLICATE expense rows at the same date before fastForwardPastNow's backstop fired.
 *
 * The fix: computeNextDueDate now `throw`s on an unknown frequency (default case) and advanceCustom
 * `throw`s on intervalValue<=0 — both BEFORE the period commits (processExpensePeriod's transaction
 * rolls back), so the throw lands in processReminder's per-reminder try/catch as a clean SKIP with
 * ZERO expense rows. Reachable only via DB corruption / validation bypass (Zod blocks both on the API),
 * so the corrupt rows are seeded directly via sqlite — the #13 test pattern.
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

interface TriggerResultShape {
  createdExpenses: unknown[];
  notifications: unknown[];
  skipped: Array<{ reminderId: string; reason: string; message?: string }>;
}

async function seedVehicle(): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Kia',
    model: 'Soul',
    year: 2019,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

/**
 * Seed an EXPENSE reminder with a corrupt advance config, lapsed ~13 months in the past (>maxCatchUp),
 * so pre-fix the catch-up loop would materialize a dozen duplicate $100 expenses at the same date.
 */
function seedCorruptExpenseReminder(
  id: string,
  vehicleId: string,
  opts: { frequency: string; intervalValue: number; intervalUnit: string }
): void {
  ctx.sqlite.run(
    `INSERT INTO reminders
       (id, user_id, name, type, action_mode, frequency, interval_value, interval_unit,
        trigger_mode, start_date, next_due_date, is_active, expense_amount, expense_category)
     VALUES (?, ?, 'Corrupt', 'expense', 'automatic', ?, ?, ?, 'time', 1577836800, 1577836800, 1, 100, 'misc')`,
    [id, ctx.user.id, opts.frequency, opts.intervalValue, opts.intervalUnit]
  );
  ctx.sqlite.run(`INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES (?, ?)`, [
    id,
    vehicleId,
  ]);
}

function expenseCount(reminderId: string): number {
  const row = ctx.sqlite
    .query('SELECT COUNT(*) AS n FROM expenses WHERE source_type = ? AND source_id = ?')
    .get('reminder', reminderId) as { n: number };
  return row.n;
}

describe('C151 — main catch-up loop non-progress guard (completes #13)', () => {
  test('a corrupt top-level frequency is skipped with ZERO duplicate expenses', async () => {
    const vehicleId = await seedVehicle();
    seedCorruptExpenseReminder('badfreq', vehicleId, {
      frequency: 'monthy', // typo / corruption — not in the enum
      intervalValue: 1,
      intervalUnit: 'month',
    });

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    const body = await json<DataEnvelope<TriggerResultShape>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);

    const skip = body.data.skipped.find((s) => s.reminderId === 'badfreq');
    expect(skip?.reason).toBe('error');
    expect(skip?.message ?? '').toContain('frequency');
    // The load-bearing assertion: pre-fix this was up to 12; the throw rolls back before any commit.
    expect(expenseCount('badfreq')).toBe(0);
  });

  test('a custom reminder with intervalValue=0 is skipped with ZERO duplicate expenses', async () => {
    const vehicleId = await seedVehicle();
    seedCorruptExpenseReminder('zeroiv', vehicleId, {
      frequency: 'custom',
      intervalValue: 0, // a 0 interval can't advance — would re-fire every iteration
      intervalUnit: 'month',
    });

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    const body = await json<DataEnvelope<TriggerResultShape>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);

    const skip = body.data.skipped.find((s) => s.reminderId === 'zeroiv');
    expect(skip?.reason).toBe('error');
    expect(skip?.message ?? '').toContain('intervalValue');
    expect(expenseCount('zeroiv')).toBe(0);
  });

  test('a corrupt reminder does not block a well-formed expense reminder in the same batch', async () => {
    const vehicleId = await seedVehicle();
    seedCorruptExpenseReminder('badfreq2', vehicleId, {
      frequency: 'monthy',
      intervalValue: 1,
      intervalUnit: 'month',
    });
    // A healthy monthly expense reminder, also overdue.
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Healthy recurring',
      type: 'expense',
      frequency: 'monthly',
      startDate: '2024-01-15T00:00:00.000Z',
      vehicleIds: [vehicleId],
      expenseAmount: 25,
      expenseCategory: 'misc',
    });
    const cBody = await json<DataEnvelope<{ reminder: { id: string } }>>(created);
    expect(created.status, JSON.stringify(cBody)).toBe(201);
    const goodId = cBody.data.reminder.id;

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(res.status).toBe(200);

    // Bad one skipped + zero rows; good one materialized at least one expense.
    expect(expenseCount('badfreq2')).toBe(0);
    expect(expenseCount(goodId)).toBeGreaterThanOrEqual(1);
  });
});
