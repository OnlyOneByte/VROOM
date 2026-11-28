import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { type Members, overrideOn, seedCar, seedMembers } from '../../../test-helpers/members';

let ctx: TestApp;
let m: Members;
const SHARED = 'rem-shared-car';
const PRIVATE = 'rem-private-car';

async function reminder(
  id: string,
  vehicleIds: string[],
  createdBy: string | null = null
): Promise<void> {
  await ctx.sql.run(
    "INSERT INTO reminders (id, user_id, name, type, frequency, start_date, created_by) VALUES (?, ?, 'Service', 'notification', 'monthly', 1717200000, ?)",
    [id, ctx.user.id, createdBy]
  );
  for (const vehicleId of vehicleIds) {
    await ctx.sql.run('INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES (?, ?)', [
      id,
      vehicleId,
    ]);
  }
}

async function listed(request: RequestFn, vehicleId = SHARED) {
  const res = await request('GET', `/api/v1/reminders?vehicleId=${vehicleId}`);
  if (!res.ok) return { status: res.status, vehicleIds: {} };
  const body = await json<DataEnvelope<{ reminder: { id: string }; vehicleIds: string[] }[]>>(res);
  return {
    status: res.status,
    vehicleIds: Object.fromEntries(body.data.map((row) => [row.reminder.id, row.vehicleIds])),
  };
}

const remove = (request: RequestFn, id: string) =>
  request('DELETE', `/api/v1/reminders/${id}`).then((res) => res.status);

beforeEach(async () => {
  ctx = await createTestApp();
  await seedCar(ctx, SHARED);
  await seedCar(ctx, PRIVATE);
  m = await seedMembers(ctx, SHARED, 'rem');
  await reminder('both-cars', [SHARED, PRIVATE]);
  await reminder('editors-reminder', [SHARED], m.editor.id);
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

describe('reminder vehicle lists show only vehicles the caller can see', () => {
  test('the owner sees every vehicle; editors and viewers only the shared car; strangers 404', async () => {
    expect((await listed(ctx.authed)).vehicleIds['both-cars']?.sort()).toEqual(
      [PRIVATE, SHARED].sort()
    );
    for (const member of [m.editor, m.viewer, m.coOwner]) {
      expect((await listed(member.request)).vehicleIds['both-cars']).toEqual([SHARED]);
    }
    expect((await listed(m.stranger.request)).status).toBe(404);
    expect((await listed(m.disabled.request)).status).toBe(403);
  });
});

describe('reminders resolve through can() for every role', () => {
  test("a viewer can read a reminder's generated expenses, only on cars they can see", async () => {
    for (const [id, vehicleId] of [
      ['e-shared', SHARED],
      ['e-private', PRIVATE],
    ]) {
      await ctx.sql.run(
        "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, source_type, source_id) VALUES (?, ?, ?, 'maintenance', 1717200000, 900, 'reminder', 'both-cars')",
        [id, vehicleId, ctx.user.id]
      );
    }
    const res = await m.viewer.request('GET', '/api/v1/reminders/both-cars/expenses');
    expect(res.status).toBe(200);
    const ids = (await json<DataEnvelope<{ id: string }[]>>(res)).data.map((e) => e.id);
    expect(ids).toEqual(['e-shared']);
    expect((await m.stranger.request('GET', '/api/v1/reminders/both-cars/expenses')).status).toBe(
      404
    );
  });

  test('deletes: editors only their own, co-owners any shared reminder', async () => {
    await reminder('owners-reminder', [SHARED]);
    expect(await remove(m.editor.request, 'owners-reminder')).toBe(403);
    expect(await remove(m.editor.request, 'editors-reminder')).toBe(200);
    expect(await remove(m.viewer.request, 'owners-reminder')).toBe(403);
    expect(await remove(m.coOwner.request, 'both-cars')).toBe(404);
    expect(await remove(m.coOwner.request, 'owners-reminder')).toBe(200);
  });

  test('overrides: a deny hides reminders, an allow lets a viewer edit one', async () => {
    await overrideOn(ctx, SHARED, m.editor, 'vehicle.reminder.read', 'deny');
    expect((await listed(m.editor.request)).status).toBe(403);
    const rename = { name: 'Renamed' };
    expect(
      (await m.viewer.request('PUT', '/api/v1/reminders/editors-reminder', rename)).status
    ).toBe(403);
    await overrideOn(ctx, SHARED, m.viewer, 'vehicle.reminder.write', 'allow');
    expect(
      (await m.viewer.request('PUT', '/api/v1/reminders/editors-reminder', rename)).status
    ).toBe(200);
  });

  test("another person's inbox, costs and reminders stay theirs", async () => {
    await ctx.sql.run(
      "INSERT INTO reminder_notifications (id, reminder_id, user_id, due_date) VALUES ('n1', 'both-cars', ?, 1717200000)",
      [ctx.user.id]
    );
    const inbox = await m.stranger.request('GET', '/api/v1/reminders/notifications');
    expect((await json<DataEnvelope<unknown[]>>(inbox)).data).toEqual([]);
    const unfiltered = await m.stranger.request('GET', '/api/v1/reminders');
    expect((await json<DataEnvelope<unknown[]>>(unfiltered)).data).toEqual([]);
    expect(await remove(m.stranger.request, 'both-cars')).toBe(404);
    expect((await listed(m.stranger.request, PRIVATE)).status).toBe(404);
  });
});
