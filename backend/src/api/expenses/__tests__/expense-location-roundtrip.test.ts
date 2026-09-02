/**
 * expense-location T2 — the create/update + round-trip guard for the optional `location` field.
 * Mirrors update-clear-description.test.ts (the clear-optional-field class): a provided location
 * persists + reads back; an absent location is NULL; a PUT location:null CLEARS it; a PUT without
 * location leaves the stored value untouched; an over-cap location is rejected (400). Free-text only
 * (D1 — no GPS); the field rides the unchanged create/update path (the handler spreads the validated
 * body, so `location` auto-flows into the insert).
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules, so keep static imports to the
 * harness + bun:test.
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

interface ExpenseDb {
  id: string;
  location: string | null;
}

function locationOf(id: string): string | null {
  return (ctx.sqlite.query('SELECT location FROM expenses WHERE id = ?').get(id) as ExpenseDb)
    .location;
}

async function createExpense(
  vehicleId: string,
  body: Record<string, unknown>
): Promise<{ status: number; id?: string; text: string }> {
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'misc',
    expenseAmount: 12,
    date: '2024-06-01T00:00:00.000Z',
    ...body,
  });
  const text = await res.clone().text();
  if (res.status !== 201) return { status: res.status, text };
  const parsed = await json<DataEnvelope<{ id: string }>>(res);
  return { status: res.status, id: parsed.data.id, text };
}

describe('expense location — create + update round-trip (expense-location T2)', () => {
  test('a provided location persists and reads back', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const { status, id, text } = await createExpense(vehicleId, { location: 'Shell, Main St' });
    expect(status, text).toBe(201);
    expect(locationOf(id as string)).toBe('Shell, Main St');

    // It also comes back through the API read (the generic select returns the column).
    const res = await ctx.authed('GET', `/api/v1/expenses/${id}`);
    expect(res.status).toBe(200);
    const row = (await json<DataEnvelope<{ location?: string }>>(res)).data;
    expect(row.location).toBe('Shell, Main St');
  });

  test('an expense created WITHOUT a location is NULL (fully optional)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Misc', model: 'Co', year: 2024 });
    const { status, id, text } = await createExpense(vehicleId, {});
    expect(status, text).toBe(201);
    expect(locationOf(id as string)).toBeNull();
  });

  test('PUT location:null clears a previously-saved location (clear-on-edit)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const { id } = await createExpense(vehicleId, { location: 'Downtown garage' });
    expect(locationOf(id as string)).toBe('Downtown garage');

    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, { location: null });
    expect(res.status, await res.text()).toBe(200);
    expect(locationOf(id as string), 'location should be NULL, not the stale value').toBeNull();
  });

  test('PUT without location leaves the stored value untouched', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const { id } = await createExpense(vehicleId, { location: 'Keep me' });

    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, { expenseAmount: 99 });
    expect(res.status, await res.text()).toBe(200);
    expect(locationOf(id as string)).toBe('Keep me');
  });

  test('an over-cap location is rejected (400, the length bound)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Misc', model: 'Co', year: 2024 });
    const tooLong = 'x'.repeat(201); // locationMaxLength is 200
    const { status, text } = await createExpense(vehicleId, { location: tooLong });
    expect(status).toBe(400);
    expect(text).toMatch(/Location must be|characters or less/i);
  });
});
