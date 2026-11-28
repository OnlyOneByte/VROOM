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
const CAR = 'mrr-car';

beforeEach(async () => {
  ctx = await createTestApp();
  await seedCar(ctx, CAR);
  m = await seedMembers(ctx, CAR, 'mrr');
  const reminder = await m.editor.request('POST', '/api/v1/reminders', {
    name: 'Wash',
    type: 'notification',
    frequency: 'monthly',
    startDate: '2026-01-01T12:00:00.000Z',
    vehicleIds: [CAR],
  });
  expect(reminder.status).toBe(201);
  const policy = await ctx.authed('POST', '/api/v1/insurance', {
    company: 'Acme',
    terms: [
      { startDate: '2026-01-01', endDate: '2026-12-31', vehicleCoverage: { vehicleIds: [CAR] } },
    ],
  });
  expect(policy.status).toBe(201);
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function rows(request: RequestFn, path: string): Promise<Record<string, unknown>[]> {
  const res = await request('GET', path);
  expect(res.status, path).toBe(200);
  return (await json<DataEnvelope<Record<string, unknown>[]>>(res)).data;
}

const reminderOf = (row: Record<string, unknown>) => row['reminder'] as Record<string, unknown>;

describe('reminder and insurance rows on a shared car', () => {
  test('reach members without user id fields', async () => {
    for (const member of [m.viewer, m.editor]) {
      const [reminder] = await rows(member.request, `/api/v1/reminders?vehicleId=${CAR}`);
      expect(
        reminder && ('userId' in reminderOf(reminder) || 'createdBy' in reminderOf(reminder))
      ).toBe(false);
      const [policy] = await rows(member.request, `/api/v1/insurance/vehicles/${CAR}/policies`);
      expect(policy && 'userId' in policy).toBe(false);
    }
  });

  test('still carry them for the owner', async () => {
    const [reminder] = await rows(ctx.authed, `/api/v1/reminders?vehicleId=${CAR}`);
    expect(reminder && reminderOf(reminder)['userId']).toBe(ctx.user.id);
    expect(reminder && reminderOf(reminder)['createdBy']).toBe(m.editor.id);
  });
});
