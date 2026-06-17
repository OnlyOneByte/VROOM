/**
 * Characterization (C441 bug fix): merge-mode restore + the un-probed `reminders` primary-key collision.
 *
 * `detectConflicts` probed vehicles/expenses/financing/insurance/photos/photoRefs + (C300) prefs/syncState
 * — but NOT `reminders`, while `insertBackupData` inserts it (restore.ts). `reminders` is userId-owned with
 * its OWN id PK and is NOT FK'd to vehicles: the vehicle link is the `reminder_vehicles` junction
 * (onDelete:cascade). So a reminder SURVIVES the deletion of all its vehicles (the #97 vehicle-less-but-
 * active state). A MERGE restore of a backup carrying that surviving reminder therefore slipped past
 * conflict detection (no probed table collides once the vehicle is gone) straight into `insert(reminders)`
 * against the existing id PK → a raw `UNIQUE constraint failed: reminders.id` that threw and rolled back the
 * WHOLE restore — the #93/C300 raw-throw class on a third table that fix never reached (the coverage-guard's
 * `reminders` exemption rested on a FALSE "child of vehicles" FK claim).
 *
 * FIX (C441): detectConflicts now probes `reminders` (userId-owned, id PK) like any other owned table, so the
 * collision is reported as a normal merge conflict instead of a raw SQLite throw. RED before the fix (threw
 * "UNIQUE constraint failed: reminders.id"), GREEN after. createTestApp rewrites env + dynamic-imports the
 * DB-bound modules.
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

async function createVehicle(make: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', { make, model: 'X', year: 2021 });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

describe('restore merge: reminders PK collision is detected as a conflict, not a raw DB throw (C441, #97 state)', () => {
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

    // DELETE the vehicle: reminder_vehicles cascades away, but the reminders row SURVIVES vehicle-less
    // (the #97 state). The backup still carries that reminder. Now the only backup rows that still collide
    // with the live DB are the surviving reminder (id PK) + the always-present prefs row.
    const delRes = await ctx.authed('DELETE', `/api/v1/vehicles/${vehicleId}`);
    expect(delRes.status).toBeLessThan(300);
    const reminderRow = ctx.sqlite
      .query('SELECT id FROM reminders WHERE id = ?')
      .all(reminderId) as { id: string }[];
    expect(
      reminderRow,
      'the reminder survives the vehicle delete (vehicle-less, #97)'
    ).toHaveLength(1);
    const junctionRows = ctx.sqlite
      .query('SELECT vehicle_id FROM reminder_vehicles WHERE reminder_id = ?')
      .all(reminderId) as unknown[];
    expect(junctionRows, 'its junction row cascaded away').toHaveLength(0);

    // EXPECTED (post-fix): the merge reports a conflict whose `table === 'reminders'` for the colliding
    // surviving reminder. NON-VACUOUS: the importer's always-present prefs row ALSO collides (C300), so a
    // bare "conflicts.length > 0" can't distinguish the fix — the reminders-TYPED conflict can ONLY appear
    // if detectConflicts probes `reminders`. Pre-fix (reminders unprobed) there is NO reminders conflict;
    // the unprobed reminder instead reaches insert(reminders) on any non-conflicting merge → raw UNIQUE throw.
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
        `it (pre-fix: unprobed → raw UNIQUE throw on insert). threw: ${
          threw instanceof Error ? threw.message : String(threw)
        }`
    ).toBe(true);
  });
});
