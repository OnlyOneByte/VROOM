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

describe('expense update preserves tags', () => {
  test('editing only the amount must NOT wipe the tags', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Fit', year: 2019 });
    const id = await createTaggedExpense(vehicleId, ['business', 'reimbursable']);
    expect(tagsOf(id)).toEqual(['business', 'reimbursable']);

    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, { expenseAmount: 99 });
    expect(res.status, await res.text()).toBe(200);

    expect(tagsOf(id), 'tags must survive an unrelated-field edit').toEqual([
      'business',
      'reimbursable',
    ]);
  });

  test('an explicit tags array on update still replaces them (normal edit unaffected)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Fit', year: 2019 });
    const id = await createTaggedExpense(vehicleId, ['old']);

    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, { tags: ['new', 'fresh'] });
    expect(res.status, await res.text()).toBe(200);

    expect(tagsOf(id)).toEqual(['new', 'fresh']);
  });
});

describe('a tag containing a separator is rejected', () => {
  test('CREATE with a semicolon in a tag → 400, nothing persisted', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Fit', year: 2019 });
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 20,
      date: '2024-06-01T00:00:00.000Z',
      tags: ['oil; filter'],
    });
    expect(res.status).toBe(400);
    const list = await ctx.authed('GET', '/api/v1/expenses?limit=10');
    expect((await json<DataEnvelope<unknown[]>>(list)).data).toHaveLength(0);
  });

  test('CREATE with a comma in a tag → 400', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Fit', year: 2019 });
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 20,
      date: '2024-06-01T00:00:00.000Z',
      tags: ['cheap,fast'],
    });
    expect(res.status).toBe(400);
  });

  test('UPDATE that introduces a delimiter tag → 400 (the stored tags survive)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Fit', year: 2019 });
    const id = await createTaggedExpense(vehicleId, ['clean']);
    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, { tags: ['a;b'] });
    expect(res.status).toBe(400);
    expect(tagsOf(id)).toEqual(['clean']);
  });

  test('a normal separator-free tag still creates fine (control)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Fit', year: 2019 });
    const id = await createTaggedExpense(vehicleId, ['road-trip', 'business']);
    expect(tagsOf(id)).toEqual(['road-trip', 'business']);
  });
});
