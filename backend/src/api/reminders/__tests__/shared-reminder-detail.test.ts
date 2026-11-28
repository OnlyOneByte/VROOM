import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee, type Invitee } from '../../../test-helpers/invitee';

let ctx: TestApp;
let viewer: Invitee;
let shared: string;
let other: string;

beforeEach(async () => {
  ctx = await createTestApp();
  viewer = await createInvitee(ctx, 'reminder-viewer', 'Viewer');
  shared = await car('Shared');
  other = await car('Other');
  const invite = await post<{ id: string }>('/api/v1/shares', {
    vehicleId: shared,
    email: viewer.email,
    level: 'viewer',
  });
  expect((await viewer.request('POST', `/api/v1/shares/${invite.id}/accept`)).status).toBe(200);
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await ctx.authed('POST', path, body);
  const data = await json<DataEnvelope<T>>(res);
  expect(res.status, `${path}: ${JSON.stringify(data)}`).toBeLessThan(300);
  return data.data;
}

async function car(make: string): Promise<string> {
  return (await post<{ id: string }>('/api/v1/vehicles', { make, model: 'X', year: 2020 })).id;
}

const reminder = (extra: Record<string, unknown>) =>
  post('/api/v1/reminders', {
    name: 'Parking permit',
    type: 'expense',
    frequency: 'monthly',
    startDate: '2030-01-01T00:00:00.000Z',
    expenseCategory: 'misc',
    ...extra,
  });

type Listed = {
  vehicleIds: string[];
  reminder: { expenseAmount: number | null; expenseSplitConfig: unknown };
};

async function viewersList(): Promise<Listed[]> {
  const res = await viewer.request('GET', `/api/v1/reminders?vehicleId=${shared}`);
  const body = await json<DataEnvelope<Listed[]>>(res);
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body.data;
}

describe('reminder details for someone a car is shared with', () => {
  test('a split reminder shows only the shared car and its share', async () => {
    await reminder({
      vehicleIds: [shared, other],
      expenseAmount: 300,
      expenseSplitConfig: {
        method: 'absolute',
        allocations: [
          { vehicleId: shared, amount: 50 },
          { vehicleId: other, amount: 250 },
        ],
      },
    });

    const [row] = await viewersList();

    expect(row.vehicleIds).toEqual([shared]);
    expect(row.reminder.expenseAmount).toBe(50);
    expect(row.reminder.expenseSplitConfig).toEqual({
      method: 'absolute',
      allocations: [{ vehicleId: shared, amount: 50 }],
    });
    expect(JSON.stringify(row)).not.toContain(other);
  });

  test('an even split shows only the shared car’s part', async () => {
    await reminder({
      vehicleIds: [shared, other],
      expenseAmount: 90,
      expenseSplitConfig: { method: 'even', vehicleIds: [shared, other] },
    });

    const [row] = await viewersList();

    expect(row.reminder.expenseAmount).toBe(45);
    expect(JSON.stringify(row)).not.toContain(other);
  });

  test('an unsplit amount on cars not all shared is not shown', async () => {
    await reminder({ vehicleIds: [other, shared], expenseAmount: 120 });

    const [row] = await viewersList();

    expect(row.vehicleIds).toEqual([shared]);
    expect(row.reminder.expenseAmount).toBeNull();
  });

  test('the owner still sees the whole reminder', async () => {
    await reminder({
      vehicleIds: [shared, other],
      expenseAmount: 300,
      expenseSplitConfig: { method: 'even', vehicleIds: [shared, other] },
    });

    const res = await ctx.authed('GET', '/api/v1/reminders');
    const body = await json<DataEnvelope<Listed[]>>(res);

    expect(body.data[0].reminder.expenseAmount).toBe(300);
    expect(body.data[0].vehicleIds.sort()).toEqual([shared, other].sort());
  });
});
