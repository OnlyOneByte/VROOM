/**
 * In-process HTTP tests for expense search/pagination through the REAL stack.
 *
 * Proves the query-param → zValidator coercion → findPaginated → SQL path that
 * the search/pagination UX bug lived in: search applied across the whole result
 * set (server-side), not just the current page.
 *
 * createTestApp() must run before static config/connection imports — keep this
 * file's imports to the harness + bun:test only.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type PaginatedEnvelope,
  type TestApp,
} from '../../../test-helpers/http-client';

/** Minimal shapes the assertions below read off the JSON envelopes. */
interface ExpenseRow {
  id: string;
  description: string;
  category: string;
}

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function seedVehicle(): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Honda',
    model: 'Civic',
    year: 2021,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

async function createExpense(
  vehicleId: string,
  category: string,
  amount: number,
  description: string,
  date: string
) {
  // Fuel expenses require fuel amount + mileage (a create-schema refinement) —
  // provide them so the POST validates. Non-fuel categories don't need them.
  const fuelFields = category === 'fuel' ? { volume: 10, mileage: 30_000 } : {};
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category,
    expenseAmount: amount,
    date,
    description,
    ...fuelFields,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.id;
}

describe('expenses HTTP search/pagination', () => {
  test('?search= matches description across the whole result set', async () => {
    const vehicleId = await seedVehicle();
    await createExpense(
      vehicleId,
      'maintenance',
      75,
      'Jiffy Lube oil change',
      '2026-01-10T12:00:00.000Z'
    );
    await createExpense(vehicleId, 'fuel', 45, 'Chevron gas', '2026-01-15T12:00:00.000Z');
    await createExpense(vehicleId, 'misc', 8, 'Highway toll', '2026-01-18T12:00:00.000Z');

    const res = await ctx.authed('GET', '/api/v1/expenses?search=jiffy');
    expect(res.status).toBe(200);
    const body = await json<PaginatedEnvelope<ExpenseRow>>(res);
    expect(body.pagination.totalCount).toBe(1);
    expect(body.data[0].description).toBe('Jiffy Lube oil change');
  });

  test('?search= also matches category', async () => {
    const vehicleId = await seedVehicle();
    await createExpense(vehicleId, 'maintenance', 75, 'oil', '2026-01-10T12:00:00.000Z');
    await createExpense(vehicleId, 'fuel', 45, 'gas', '2026-01-15T12:00:00.000Z');

    const res = await ctx.authed('GET', '/api/v1/expenses?search=mainten');
    const body = await json<PaginatedEnvelope<ExpenseRow>>(res);
    expect(body.pagination.totalCount).toBe(1);
    expect(body.data[0].category).toBe('maintenance');
  });

  test('limit/offset paginate the full set', async () => {
    const vehicleId = await seedVehicle();
    for (let i = 0; i < 5; i++) {
      const day = String(10 + i).padStart(2, '0');
      await createExpense(vehicleId, 'misc', 1 + i, `row ${i}`, `2026-02-${day}T12:00:00.000Z`);
    }

    const page1 = await ctx.authed('GET', '/api/v1/expenses?limit=2&offset=0');
    const b1 = await json<PaginatedEnvelope<ExpenseRow>>(page1);
    expect(b1.data).toHaveLength(2);
    expect(b1.pagination.totalCount).toBe(5);

    const page2 = await ctx.authed('GET', '/api/v1/expenses?limit=2&offset=2');
    const b2 = await json<PaginatedEnvelope<ExpenseRow>>(page2);
    expect(b2.data).toHaveLength(2);
    // Different rows than page 1.
    expect(b2.data[0].id).not.toBe(b1.data[0].id);
  });

  test('search is user-scoped (no cross-user leakage via the route)', async () => {
    const vehicleId = await seedVehicle();
    await createExpense(vehicleId, 'misc', 5, 'unique-marker-xyz', '2026-01-10T12:00:00.000Z');

    // A second app == a second user with a fresh DB reset; the marker must not leak.
    const other = await createTestApp();
    try {
      const res = await other.authed('GET', '/api/v1/expenses?search=unique-marker-xyz');
      const body = await json<PaginatedEnvelope<ExpenseRow>>(res);
      expect(body.pagination.totalCount).toBe(0);
    } finally {
      other.close();
    }
  });
});

/**
 * PUT /:id vehicle-reassignment ownership (#61, C189): the CREATE path validates the target vehicle
 * is the user's (validateVehicleOwnership), but the UPDATE path did NOT — so a PUT could point the
 * (owned) expense at a vehicleId the user doesn't own, corrupting their analytics attribution. The
 * create path's own guard is the model; this pins the symmetric update guard. Raw-seed a FOREIGN
 * user+vehicle that coexists in the shared DB (a second createTestApp would reset it).
 */
describe('PUT /api/v1/expenses/:id — vehicle reassignment ownership (#61)', () => {
  test('reassigning the expense to a FOREIGN vehicle is rejected 404 (ownership guard)', async () => {
    const vehicleId = await seedVehicle();
    const expenseId = await createExpense(
      vehicleId,
      'misc',
      12,
      'reassign me',
      '2026-03-01T12:00:00.000Z'
    );

    // A vehicle owned by ANOTHER user, seeded directly so it coexists with ours.
    ctx.sqlite.run(
      `INSERT INTO users (id, email, display_name) VALUES ('u-foreign-61', 'f61@test.com', 'Foreign')`
    );
    ctx.sqlite.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('veh-foreign-61', 'u-foreign-61', 'Mazda', '3', 2020)`
    );

    const res = await ctx.authed('PUT', `/api/v1/expenses/${expenseId}`, {
      vehicleId: 'veh-foreign-61',
    });
    expect(res.status).toBe(404); // validateVehicleOwnership → NotFoundError (not-owned ≡ not-found)

    // The expense still points at the ORIGINAL (owned) vehicle — the bad write never landed.
    const getRes = await ctx.authed('GET', `/api/v1/expenses/${expenseId}`);
    const body = await json<DataEnvelope<{ vehicleId: string }>>(getRes);
    expect(body.data.vehicleId).toBe(vehicleId);
  });

  test('reassigning to the user’s OWN second vehicle still works (200) — guard isn’t over-broad', async () => {
    const v1 = await seedVehicle();
    const v2 = await seedVehicle();
    const expenseId = await createExpense(v1, 'misc', 9, 'move to v2', '2026-03-02T12:00:00.000Z');

    const res = await ctx.authed('PUT', `/api/v1/expenses/${expenseId}`, { vehicleId: v2 });
    expect(res.status).toBe(200);
    const body = await json<DataEnvelope<{ vehicleId: string }>>(res);
    expect(body.data.vehicleId).toBe(v2);
  });

  test('a PUT that does NOT touch vehicleId still updates normally (no regression)', async () => {
    const vehicleId = await seedVehicle();
    const expenseId = await createExpense(
      vehicleId,
      'misc',
      5,
      'before',
      '2026-03-03T12:00:00.000Z'
    );

    const res = await ctx.authed('PUT', `/api/v1/expenses/${expenseId}`, { description: 'after' });
    expect(res.status).toBe(200);
    const body = await json<DataEnvelope<{ description: string; vehicleId: string }>>(res);
    expect(body.data.description).toBe('after');
    expect(body.data.vehicleId).toBe(vehicleId);
  });
});
