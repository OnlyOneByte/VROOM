import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function createVehicle(make: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', { make, model: 'X', year: 2021 });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

describe('restore merge: a reminder already here is kept and relinked', () => {
  test('after the car is deleted, merge brings the car and its reminder link back without duplicating the reminder', async () => {
    const vehicleId = await createVehicle('Honda');
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Registration renewal',
      type: 'notification',
      frequency: 'yearly',
      startDate: '2024-02-01T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const cbody = await json<DataEnvelope<{ reminder: { id: string } }>>(created);
    expect(created.status, JSON.stringify(cbody)).toBe(201);
    const reminderId = cbody.data.reminder.id;

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);

    const delRes = await ctx.authed('DELETE', `/api/v1/vehicles/${vehicleId}`);
    expect(delRes.status).toBeLessThan(300);
    const reminderRow = (await ctx.sql.all('SELECT id FROM reminders WHERE id = ?', [reminderId])) as { id: string }[];
    expect(reminderRow, 'the reminder survives the vehicle delete (vehicle-less,)').toHaveLength(1);
    const junctionRows = (await ctx.sql.all('SELECT vehicle_id FROM reminder_vehicles WHERE reminder_id = ?', [reminderId])) as unknown[];
    expect(junctionRows, 'its junction row cascaded away').toHaveLength(0);

    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'merge');

    expect(result.success).toBe(true);
    expect(result.imported?.vehicles).toBe(1);
    expect(result.kept?.reminders, 'the surviving reminder is kept, not inserted twice').toBe(1);
    expect(result.imported?.reminderVehicles, 'its link to the restored car comes back').toBe(1);
    const links = (await ctx.sql.all('SELECT vehicle_id FROM reminder_vehicles WHERE reminder_id = ?', [reminderId])) as { vehicle_id: string }[];
    expect(links).toEqual([{ vehicle_id: vehicleId }]);
  });
});
