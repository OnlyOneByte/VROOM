/**
 * Regression guard for the clear-optional-field data-loss class (cycles 82-85),
 * the LAST open instance: an expense `description` emptied on edit must actually
 * CLEAR (column → NULL), not silently keep its old value. The frontend fix sends
 * description:null on edit (toBackendExpense isEdit); this proves the backend half
 * — the update schema accepts null (.nullish()) and BaseRepository.update writes
 * it through. Also pins that a normal (undefined) update leaves it untouched, and
 * that create still omits an empty description (the offline-safe create payload).
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules, so keep static
 * imports to the harness + bun:test.
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

interface ExpenseDb {
  id: string;
  description: string | null;
}

function descriptionOf(id: string): string | null {
  return (ctx.sqlite.query('SELECT description FROM expenses WHERE id = ?').get(id) as ExpenseDb)
    .description;
}

async function createWithDescription(vehicleId: string, description: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'misc',
    expenseAmount: 12,
    date: '2024-06-01T00:00:00.000Z',
    description,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.id;
}

describe('expense description clear-on-edit (clear-field class, last instance)', () => {
  test('PUT description:null clears a previously-saved description', async () => {
    const vehicleId = await seedVehicle();
    const id = await createWithDescription(vehicleId, 'Parking garage downtown');
    expect(descriptionOf(id)).toBe('Parking garage downtown');

    // What the edit form now sends when the user empties the description field.
    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, { description: null });
    expect(res.status, await res.text()).toBe(200);

    expect(descriptionOf(id), 'description should be NULL, not the stale value').toBeNull();
  });

  test('PUT without description leaves the stored value untouched', async () => {
    const vehicleId = await seedVehicle();
    const id = await createWithDescription(vehicleId, 'Keep me');

    // An unrelated field update must not disturb description (undefined is dropped).
    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, { expenseAmount: 99 });
    expect(res.status, await res.text()).toBe(200);

    expect(descriptionOf(id)).toBe('Keep me');
  });

  test('create still persists a provided description (no regression)', async () => {
    const vehicleId = await seedVehicle();
    const id = await createWithDescription(vehicleId, 'Oil change');
    expect(descriptionOf(id)).toBe('Oil change');
  });
});
