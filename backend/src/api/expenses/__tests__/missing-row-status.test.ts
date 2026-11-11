/**
 * Status-code contract for an expense id the acting user cannot act on.
 *
 * GET/PUT/DELETE /expenses/:id must ALL answer 404 "Expense not found" for a row that does not
 * exist, and the SAME 404 for a row that exists but belongs to someone else. Those two cases
 * answering differently is an id-existence oracle, and the existence-hiding the write handlers
 * document only holds if the absent-row branch matches the denial branch.
 *
 * PUT and DELETE used to throw ValidationError('Expense') for an absent row — a 400 whose
 * user-facing message was the bare word "Expense" (ValidationError passes its argument straight
 * through), so a double-tapped delete surfaced a toast reading "Expense".
 *
 * createTestApp() must run before static config/connection imports — keep this file's imports to
 * the harness + bun:test only.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

interface ErrorEnvelope {
  error: { code: string; message: string };
}

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

const ABSENT_ID = 'no-such-expense-id';

/** Seed a user + vehicle + expense owned by SOMEONE ELSE, coexisting in the shared DB. */
function seedForeignExpense(): string {
  ctx.sqlite.run(
    `INSERT INTO users (id, email, display_name) VALUES ('u-foreign-status', 'fstatus@test.com', 'Foreign')`
  );
  ctx.sqlite.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('veh-foreign-status', 'u-foreign-status', 'Mazda', '3', 2020)`
  );
  ctx.sqlite.run(
    `INSERT INTO expenses (id, vehicle_id, category, date, expense_amount, user_id)
     VALUES ('exp-foreign-status', 'veh-foreign-status', 'misc', 1700000000000, 4200, 'u-foreign-status')`
  );
  return 'exp-foreign-status';
}

describe('expenses/:id — absent row answers 404, not 400', () => {
  for (const method of ['GET', 'PUT', 'DELETE'] as const) {
    test(`${method} on an absent id → 404 NotFoundError "Expense not found"`, async () => {
      const body = method === 'PUT' ? { description: 'edited' } : undefined;
      const res = await ctx.authed(method, `/api/v1/expenses/${ABSENT_ID}`, body);
      const envelope = await json<ErrorEnvelope>(res);

      expect(res.status, JSON.stringify(envelope)).toBe(404);
      expect(envelope.error.code).toBe('NotFoundError');
      // Never the bare resource name: that is what a toast shows the user.
      expect(envelope.error.message).toBe('Expense not found');
    });
  }

  test('DELETE twice: the second delete 404s instead of 400ing with a bare "Expense"', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const createRes = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 12,
      date: '2026-03-01T12:00:00.000Z',
      description: 'double-tap me',
    });
    const created = await json<DataEnvelope<{ id: string }>>(createRes);
    expect(createRes.status, JSON.stringify(created)).toBe(201);

    const first = await ctx.authed('DELETE', `/api/v1/expenses/${created.data.id}`);
    expect(first.status).toBe(200);

    const second = await ctx.authed('DELETE', `/api/v1/expenses/${created.data.id}`);
    const envelope = await json<ErrorEnvelope>(second);
    expect(second.status, JSON.stringify(envelope)).toBe(404);
    expect(envelope.error.message).toBe('Expense not found');
  });
});

describe('expenses/:id — status cannot discriminate existence', () => {
  // Only the STATUS is asserted equal. The foreign row is denied by the vehicle access seam, whose
  // message is "Vehicle not found" rather than "Expense not found", so the bodies still differ —
  // unifying them belongs to that seam, not here. Ids are server-side cuid2, so the remaining
  // message difference carries no enumeration value; a 400-vs-404 split did, and this pins it shut.
  test('an existing FOREIGN id answers the same 404 as an absent one on every verb', async () => {
    const foreignId = seedForeignExpense();

    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      const body = method === 'PUT' ? { description: 'edited' } : undefined;
      const absent = await ctx.authed(method, `/api/v1/expenses/${ABSENT_ID}`, body);
      const foreign = await ctx.authed(method, `/api/v1/expenses/${foreignId}`, body);

      expect(absent.status, `${method} absent`).toBe(404);
      expect(foreign.status, `${method} foreign`).toBe(404);
    }

    // The foreign row is untouched by the denied DELETE.
    const remaining = ctx.sqlite
      .query('SELECT COUNT(*) as n FROM expenses WHERE id = ?')
      .get(foreignId) as { n: number };
    expect(remaining.n, 'the foreign expense survived the denied DELETE').toBe(1);
  });
});
