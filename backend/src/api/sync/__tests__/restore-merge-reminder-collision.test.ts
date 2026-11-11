// Merge restore must report a reminders primary-key collision as a conflict. A reminder can outlive
// its vehicles, so it has to be probed directly rather than through the vehicle link.

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

async function createVehicle(make: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', { make, model: 'X', year: 2021 });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

describe('restore merge: reminders PK collision is detected as a conflict, not a raw DB throw', () => {
  test('merging a backup whose surviving vehicle-less reminder collides → clean conflict, not an unhandled PK throw', async () => {
    // Own a vehicle + a reminder linked to it; export a real ZIP carrying BOTH (+ the prefs row).
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

    // Deleting the vehicle leaves the reminder row, which still collides with the backup.
    const delRes = await ctx.authed('DELETE', `/api/v1/vehicles/${vehicleId}`);
    expect(delRes.status).toBeLessThan(300);
    const reminderRow = ctx.sqlite
      .query('SELECT id FROM reminders WHERE id = ?')
      .all(reminderId) as { id: string }[];
    expect(reminderRow, 'the reminder survives the vehicle delete (vehicle-less,)').toHaveLength(1);
    const junctionRows = ctx.sqlite
      .query('SELECT vehicle_id FROM reminder_vehicles WHERE reminder_id = ?')
      .all(reminderId) as unknown[];
    expect(junctionRows, 'its junction row cascaded away').toHaveLength(0);

    // The prefs row also collides, so only a conflict typed 'reminders' proves reminders is probed.
    let reminderConflictReported = false;
    let threw: unknown = null;
    try {
      const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'merge');
      reminderConflictReported =
        result.success === false &&
        (result.conflicts ?? []).some((c) => c.table === 'reminders' && c.id === reminderId);
    } catch (err) {
      threw = err;
    }

    expect(
      reminderConflictReported,
      `merge should report the surviving reminder (${reminderId}) as a 'reminders'-table conflict, not omit ` +
        `it (an unprobed row reaches the insert and throws a raw UNIQUE error). threw: ${
          threw instanceof Error ? threw.message : String(threw)
        }`
    ).toBe(true);
  });
});
