import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee, type Invitee } from '../../../test-helpers/invitee';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;
let b: Invitee;

beforeEach(async () => {
  ctx = await createTestApp();
  b = await createInvitee(ctx, 'remw-invitee');
});
afterEach(() => ctx.close());

async function shareAccepted(level: 'viewer' | 'editor'): Promise<string> {
  const vehicleId = await seedVehicle(ctx, { make: 'Shared', model: 'Car', year: 2021 });
  await b.acceptShare(vehicleId, level);
  return vehicleId;
}

function storedReminderUserId(reminderId: string): string {
  return (
    ctx.sqlite.query('SELECT user_id FROM reminders WHERE id = ?').get(reminderId) as {
      user_id: string;
    }
  ).user_id;
}

interface ReminderEnvelope {
  reminder: { id: string };
  vehicleIds: string[];
}

describe('reminder writes on shared vehicles', () => {
  test('an EDITOR create stamps the reminder userId=OWNER (rides the owner books)', async () => {
    const vehicleId = await shareAccepted('editor');

    const res = await b.request('POST', '/api/v1/reminders', {
      name: 'Editor oil change',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-06-01T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const body = await json<DataEnvelope<ReminderEnvelope>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    const rid = body.data.reminder.id;

    expect(storedReminderUserId(rid)).toBe(ctx.user.id);

    const ownerList = await json<DataEnvelope<ReminderEnvelope[]>>(
      await ctx.authed('GET', `/api/v1/reminders?vehicleId=${vehicleId}`)
    );
    expect(ownerList.data.find((r) => r.reminder.id === rid)).toBeDefined();
  });

  test('an editor expense reminder materializes its expense onto the owner books', async () => {
    const vehicleId = await shareAccepted('editor');
    const res = await b.request('POST', '/api/v1/reminders', {
      name: 'Editor annual reg',
      type: 'expense',
      actionMode: 'automatic',
      frequency: 'monthly',
      startDate: '2024-01-01T00:00:00.000Z',
      expenseCategory: 'regulatory',
      expenseAmount: 100,
      vehicleIds: [vehicleId],
    });
    const body = await json<DataEnvelope<ReminderEnvelope>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    const rid = body.data.reminder.id;
    expect(storedReminderUserId(rid)).toBe(ctx.user.id);

    await ctx.authed('POST', '/api/v1/reminders/trigger');
    const materialized = ctx.sqlite
      .query("SELECT user_id FROM expenses WHERE source_type = 'reminder' AND source_id = ?")
      .all(rid) as Array<{ user_id: string }>;
    for (const row of materialized) {
      expect(row.user_id).toBe(ctx.user.id);
    }
  });

  test('an owner create on their own vehicle stamps the owner', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Owned', model: 'Car', year: 2022 });
    const res = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Self reminder',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-06-02T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const body = await json<DataEnvelope<ReminderEnvelope>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(storedReminderUserId(body.data.reminder.id)).toBe(ctx.user.id);
  });

  test('a reminder spanning two owners is rejected', async () => {
    const sharedFromA = await shareAccepted('editor');
    const bVehRes = await b.request('POST', '/api/v1/vehicles', {
      make: 'BOwn',
      model: 'Car',
      year: 2023,
    });
    const bOwn = (await json<DataEnvelope<{ id: string }>>(bVehRes)).data.id;
    expect(bVehRes.status, 'B seeds own vehicle').toBeLessThan(300);

    const res = await b.request('POST', '/api/v1/reminders', {
      name: 'Cross-owner reminder',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-06-03T00:00:00.000Z',
      vehicleIds: [sharedFromA, bOwn],
    });
    expect(res.status, 'cross-owner reminder rejected').toBe(400);
  });

  test('an editor can PUT and mark-serviced a shared reminder, and DELETE only their own', async () => {
    const vehicleId = await shareAccepted('editor');
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Tire rotation',
      type: 'notification',
      frequency: 'monthly',
      triggerMode: 'mileage',
      intervalMileage: 5000,
      startDate: '2024-06-01T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const rid = (await json<DataEnvelope<ReminderEnvelope>>(created)).data.reminder.id;

    const put = await b.request('PUT', `/api/v1/reminders/${rid}`, {
      name: 'Tire rotation (edited)',
    });
    expect(put.status, 'editor can update a shared reminder').toBe(200);
    expect(storedReminderUserId(rid)).toBe(ctx.user.id);

    const mark = await b.request('POST', `/api/v1/reminders/${rid}/mark-serviced`);
    expect(mark.status, 'editor can mark-serviced a shared reminder').toBe(200);
    expect(storedReminderUserId(rid)).toBe(ctx.user.id);

    const owners = await b.request('DELETE', `/api/v1/reminders/${rid}`);
    expect(owners.status, "editor cannot delete the owner's reminder").toBe(403);

    const mine = await b.request('POST', '/api/v1/reminders', {
      name: 'Editor reminder',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-06-01T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const mineId = (await json<DataEnvelope<ReminderEnvelope>>(mine)).data.reminder.id;
    const del = await b.request('DELETE', `/api/v1/reminders/${mineId}`);
    expect(del.status, 'editor can delete a reminder they added').toBe(200);
    expect(ctx.sqlite.query('SELECT id FROM reminders WHERE id = ?').get(mineId)).toBeNull();
  });

  test('a viewer cannot create, update, delete, or mark-serviced a shared reminder (403)', async () => {
    const vehicleId = await shareAccepted('viewer');
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Owner reminder',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-06-01T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const rid = (await json<DataEnvelope<ReminderEnvelope>>(created)).data.reminder.id;

    const create = await b.request('POST', '/api/v1/reminders', {
      name: 'Viewer reminder',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-06-02T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    expect(create.status, 'viewer create denied').toBe(403);
    expect(
      (await b.request('PUT', `/api/v1/reminders/${rid}`, { name: 'x' })).status,
      'viewer PUT'
    ).toBe(403);
    expect(
      (await b.request('POST', `/api/v1/reminders/${rid}/mark-serviced`)).status,
      'viewer mark-serviced'
    ).toBe(403);
    expect((await b.request('DELETE', `/api/v1/reminders/${rid}`)).status, 'viewer DELETE').toBe(
      403
    );

    expect(ctx.sqlite.query('SELECT id FROM reminders WHERE id = ?').get(rid)).not.toBeNull();
  });
});

describe('reminder writes after the reminder lost its vehicles', () => {
  async function vehiclelessReminder(): Promise<string> {
    const vehicleId = await seedVehicle(ctx, { make: 'Gone', model: 'Car', year: 2019 });
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Orphaned reminder',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-06-01T00:00:00.000Z',
      endDate: '2024-06-15T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const body = await json<DataEnvelope<ReminderEnvelope>>(created);
    expect(created.status, JSON.stringify(body)).toBe(201);
    expect((await ctx.authed('DELETE', `/api/v1/vehicles/${vehicleId}`)).status).toBe(200);
    expect(
      ctx.sqlite
        .query('SELECT 1 FROM reminder_vehicles WHERE reminder_id = ?')
        .get(body.data.reminder.id)
    ).toBeNull();
    return body.data.reminder.id;
  }

  function storedReminder(rid: string): { name: string; is_active: number } | null {
    return ctx.sqlite.query('SELECT name, is_active FROM reminders WHERE id = ?').get(rid) as {
      name: string;
      is_active: number;
    } | null;
  }

  test('another user cannot read, edit, service or delete it', async () => {
    const rid = await vehiclelessReminder();
    const before = storedReminder(rid);

    const serviced = await b.request('POST', `/api/v1/reminders/${rid}/mark-serviced`);
    expect(serviced.status, 'mark-serviced').toBe(404);
    expect(await serviced.text()).not.toContain('Orphaned reminder');
    expect((await b.request('DELETE', `/api/v1/reminders/${rid}`)).status, 'DELETE').toBe(404);
    expect(
      (await b.request('PUT', `/api/v1/reminders/${rid}`, { name: 'taken' })).status,
      'PUT'
    ).toBe(404);

    expect(storedReminder(rid)).toEqual(before);
  });

  test('its owner can still service and delete it', async () => {
    const rid = await vehiclelessReminder();

    expect((await ctx.authed('POST', `/api/v1/reminders/${rid}/mark-serviced`)).status).toBe(200);
    expect(storedReminder(rid)?.is_active).toBe(0);

    expect((await ctx.authed('DELETE', `/api/v1/reminders/${rid}`)).status).toBe(200);
    expect(storedReminder(rid)).toBeNull();
  });
});
