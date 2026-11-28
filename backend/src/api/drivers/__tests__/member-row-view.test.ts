import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { type Members, seedCar, seedMembers } from '../../../test-helpers/members';

let ctx: TestApp;
let m: Members;
const CAR = 'mrv-car';
let readingId: string;
let expenseId: string;

beforeEach(async () => {
  ctx = await createTestApp();
  await seedCar(ctx, CAR);
  m = await seedMembers(ctx, CAR, 'mrv');
  const reading = await m.editor.request('POST', `/api/v1/odometer/${CAR}`, {
    odometer: 1200,
    recordedAt: '2024-04-01',
  });
  expect(reading.status).toBe(201);
  readingId = (await json<DataEnvelope<{ id: string }>>(reading)).data.id;
  const expense = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId: CAR,
    category: 'maintenance',
    date: '2024-04-02',
    expenseAmount: 40,
  });
  expect(expense.status).toBe(201);
  expenseId = (await json<DataEnvelope<{ id: string }>>(expense)).data.id;
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function rowsFrom(request: RequestFn, path: string): Promise<Record<string, unknown>[]> {
  const res = await request('GET', path);
  expect(res.status, path).toBe(200);
  const body = await json<DataEnvelope<Record<string, unknown> | Record<string, unknown>[]>>(res);
  return Array.isArray(body.data) ? body.data : [body.data];
}

const paths = () => [
  `/api/v1/odometer/${CAR}`,
  `/api/v1/odometer/entry/${readingId}`,
  `/api/v1/expenses?vehicleId=${CAR}`,
  `/api/v1/expenses/${expenseId}`,
];

describe('rows on a shared car', () => {
  test('reach members without user id fields', async () => {
    for (const path of paths()) {
      for (const row of await rowsFrom(m.viewer.request, path)) {
        expect('userId' in row || 'createdBy' in row, path).toBe(false);
      }
    }
  });

  test('still carry them for the owner', async () => {
    for (const path of paths()) {
      const [row] = await rowsFrom(ctx.authed, path);
      expect(row?.['userId'], path).toBe(ctx.user.id);
    }
  });
});
