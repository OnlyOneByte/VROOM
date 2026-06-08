/**
 * Guard for the `.partial()` + `.default()` data-loss class (cycle 34), generalizing the C31
 * footgun: a Zod field carrying a `.default(...)` SURVIVES `.partial()` — so an update schema built
 * as `base.partial()` can silently inject that default on an update that OMITS the field, clobbering
 * the stored value. C31 hit this with the reminder `triggerMode: .default('time')` (reverted an
 * existing mileage reminder on an unrelated update).
 *
 * The highest-stakes remaining instance is `updateExpenseSchema = createExpenseSchemaBase.omit(...)
 * .partial()`, whose base `tags` field is `.optional().default([])` (routes.ts). If the default
 * survives, editing ANY other field of a tagged expense (e.g. just the amount) would wipe its tags —
 * a silent data loss on the most common edit path. This pins the behavior through the REAL route →
 * repository → DB stack so it can't regress:
 *   - PUT changing only expenseAmount must LEAVE the tags intact (the load-bearing assertion)
 *   - PUT with explicit tags still replaces them (normal edit still works)
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules; keep imports to harness + bun:test.
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
    model: 'Fit',
    year: 2019,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

/** Tags column as stored (JSON-encoded array string, or null). */
function tagsOf(id: string): string[] | null {
  const row = ctx.sqlite.query('SELECT tags FROM expenses WHERE id = ?').get(id) as {
    tags: string | null;
  };
  return row.tags == null ? null : (JSON.parse(row.tags) as string[]);
}

async function createTaggedExpense(vehicleId: string, tags: string[]): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'misc',
    expenseAmount: 20,
    date: '2024-06-01T00:00:00.000Z',
    tags,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.id;
}

describe('expense update preserves tags (.partial() + .default([]) class)', () => {
  test('editing only the amount must NOT wipe the tags', async () => {
    const vehicleId = await seedVehicle();
    const id = await createTaggedExpense(vehicleId, ['business', 'reimbursable']);
    expect(tagsOf(id)).toEqual(['business', 'reimbursable']);

    // The user edits an unrelated field; no `tags` key in the payload. If the schema's
    // `.default([])` survives `.partial()`, the update would inject [] and wipe the tags.
    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, { expenseAmount: 99 });
    expect(res.status, await res.text()).toBe(200);

    expect(tagsOf(id), 'tags must survive an unrelated-field edit').toEqual([
      'business',
      'reimbursable',
    ]);
  });

  test('an explicit tags array on update still replaces them (normal edit unaffected)', async () => {
    const vehicleId = await seedVehicle();
    const id = await createTaggedExpense(vehicleId, ['old']);

    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, { tags: ['new', 'fresh'] });
    expect(res.status, await res.text()).toBe(200);

    expect(tagsOf(id)).toEqual(['new', 'fresh']);
  });
});
