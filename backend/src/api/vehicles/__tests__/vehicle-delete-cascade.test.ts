/**
 * In-process HTTP tests for vehicle deletion CASCADE — through the REAL stack.
 *
 * When a vehicle is deleted, the DB FK-cascade removes its expenses and odometer
 * entries (expenses.vehicle_id / odometer_entries.vehicle_id are ON DELETE
 * cascade). But the `photos` table links to entities by (entity_type, entity_id)
 * STRINGS — it has NO foreign key to those tables — so nothing cascades the
 * photos of the deleted expenses/odometer entries. The vehicle route only cleans
 * its OWN ('vehicle') photos. Result: orphaned photo rows (and their external
 * storage files) for every expense/odometer photo on the deleted vehicle.
 *
 * These tests pin the desired behavior: after deleting a vehicle, NO photo rows
 * for that vehicle's expenses or odometer entries remain.
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

/** Insert a photo row directly (no storage provider needed for a cascade test). */
function seedPhoto(opts: { id: string; entityType: string; entityId: string }): void {
  ctx.sqlite.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
     VALUES (?, ?, ?, ?, ?, 'image/jpeg', 1024)`,
    [opts.id, ctx.user.id, opts.entityType, opts.entityId, `${opts.id}.jpg`]
  );
}

function photoCount(entityType: string, entityId: string): number {
  const row = ctx.sqlite
    .query(`SELECT COUNT(*) AS n FROM photos WHERE entity_type = ? AND entity_id = ?`)
    .get(entityType, entityId) as { n: number };
  return row.n;
}

async function seedVehicle(): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

async function seedExpense(vehicleId: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'fuel',
    expenseAmount: 50,
    date: '2024-06-01T00:00:00.000Z',
    volume: 10,
    mileage: 30000,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

describe('vehicle deletion cascades photo cleanup to dependent entities', () => {
  test("deleting a vehicle removes its expenses' photo rows (no orphans)", async () => {
    const vehicleId = await seedVehicle();
    const expenseId = await seedExpense(vehicleId);

    // Attach a receipt photo to the expense, and a cover photo to the vehicle.
    seedPhoto({ id: 'exp-photo', entityType: 'expense', entityId: expenseId });
    seedPhoto({ id: 'veh-photo', entityType: 'vehicle', entityId: vehicleId });
    expect(photoCount('expense', expenseId)).toBe(1);
    expect(photoCount('vehicle', vehicleId)).toBe(1);

    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${vehicleId}`);
    expect(del.status, await del.text()).toBe(200);

    // The expense itself is FK-cascade-deleted...
    const expphotos = photoCount('expense', expenseId);
    const vehphotos = photoCount('vehicle', vehicleId);
    // ...and its photo row must be cleaned up too (this is the orphan bug).
    expect(expphotos, 'expense photo rows should be cleaned up on vehicle delete').toBe(0);
    expect(vehphotos, 'vehicle photo rows should be cleaned up on vehicle delete').toBe(0);
  });

  test('deleting a single expense directly removes its photo rows (no orphans)', async () => {
    const vehicleId = await seedVehicle();
    const expenseId = await seedExpense(vehicleId);
    seedPhoto({ id: 'exp-photo-direct', entityType: 'expense', entityId: expenseId });
    expect(photoCount('expense', expenseId)).toBe(1);

    const del = await ctx.authed('DELETE', `/api/v1/expenses/${expenseId}`);
    expect(del.status, await del.text()).toBe(200);

    expect(
      photoCount('expense', expenseId),
      'expense photo rows should be cleaned up on direct expense delete'
    ).toBe(0);
  });

  test("deleting a vehicle removes its odometer entries' photo rows (no orphans)", async () => {
    const vehicleId = await seedVehicle();

    // Create an odometer entry for the vehicle (POST /api/v1/odometer/:vehicleId).
    const odo = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
      odometer: 31000,
      recordedAt: '2024-06-02T00:00:00.000Z',
    });
    const odoBody = await json<DataEnvelope<{ id: string }>>(odo);
    expect(odo.status, JSON.stringify(odoBody)).toBeLessThan(300);
    const odoId = odoBody.data.id;

    seedPhoto({ id: 'odo-photo', entityType: 'odometer_entry', entityId: odoId });
    expect(photoCount('odometer_entry', odoId)).toBe(1);

    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${vehicleId}`);
    expect(del.status, await del.text()).toBe(200);

    expect(
      photoCount('odometer_entry', odoId),
      'odometer-entry photo rows should be cleaned up on vehicle delete'
    ).toBe(0);
  });
});

// CHARACTERIZATION of #97 (C318 deep-review scout, ESCALATED — product-gated, same family as #88).
// reminder_vehicles.vehicleId is onDelete:'cascade', so deleting a vehicle removes its junction row.
// A reminder linked to ONLY that vehicle is left with ZERO vehicles: the row survives + stays is_active,
// but processReminder skips it forever with reason 'no_vehicles' — a silent, never-firing orphan still
// shown as active. The fix (deactivate / delete / surface / block-delete) is a UX decision sent to Angelo
// (#97). This pins the CURRENT behavior so the eventual fix has a red→green anchor and the bug can't
// silently worsen. (A multi-vehicle reminder is unaffected — it keeps its remaining vehicles.)
describe('#97 — a single-vehicle reminder is orphaned (vehicle-less, still active) on vehicle delete', () => {
  function reminderRow(id: string): { is_active: number } | null {
    return (
      (ctx.sqlite.query('SELECT is_active FROM reminders WHERE id = ?').get(id) as {
        is_active: number;
      } | null) ?? null
    );
  }
  function junctionCount(reminderId: string): number {
    const row = ctx.sqlite
      .query('SELECT COUNT(*) AS n FROM reminder_vehicles WHERE reminder_id = ?')
      .get(reminderId) as { n: number };
    return row.n;
  }

  test('the reminder row SURVIVES (active) but ends up with zero linked vehicles → trigger skips it no_vehicles', async () => {
    const vehicleId = await seedVehicle();
    // Seed a single-vehicle time reminder directly (mileage/time API surface is partial).
    ctx.sqlite.run(
      `INSERT INTO reminders
         (id, user_id, name, type, action_mode, frequency, trigger_mode, start_date, next_due_date, is_active)
       VALUES ('rm-orphan', ?, 'Registration', 'notification', 'automatic', 'yearly', 'time', 0, 0, 1)`,
      [ctx.user.id]
    );
    ctx.sqlite.run(
      `INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES ('rm-orphan', ?)`,
      [vehicleId]
    );
    expect(junctionCount('rm-orphan')).toBe(1);

    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${vehicleId}`);
    expect(del.status, await del.text()).toBe(200);

    // CURRENT behavior: the junction row cascaded away, but the reminder row REMAINS and is STILL active.
    expect(junctionCount('rm-orphan')).toBe(0);
    expect(reminderRow('rm-orphan')?.is_active).toBe(1);

    // ...and the trigger skips it as no_vehicles (never fires, no user signal).
    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    const body =
      await json<DataEnvelope<{ skipped: Array<{ reminderId: string; reason: string }> }>>(res);
    expect(res.status).toBe(200);
    expect(
      body.data.skipped.some((s) => s.reminderId === 'rm-orphan' && s.reason === 'no_vehicles')
    ).toBe(true);
  });
});

// C366 deep-review (CERTIFIED CLEAN — pins an unguarded data-safety invariant). insurance_claims.vehicleId
// is onDelete:'set null' (schema.ts:188), deliberately UNLIKE the cascade FKs above: a claim is a financial/
// legal record (payoutAmount, claimDate, status) that belongs to its POLICY (policyId cascades), NOT to the
// vehicle — so deleting a vehicle must PRESERVE the claim with vehicleId nulled, never destroy it (NORTH_STAR
// #1: no silent loss). Nothing pinned this; a regression flipping that FK to 'cascade' (or a manual cleanup
// that over-deletes) would silently wipe a user's claim history on an unrelated vehicle delete. This anchors
// survival + the null so such a change turns RED.
describe('C366 — deleting a vehicle PRESERVES its insurance claims (vehicleId set null, not cascade-deleted)', () => {
  function claimRow(
    id: string
  ): { vehicle_id: string | null; policy_id: string; payout_amount: number } | null {
    return (
      (ctx.sqlite
        .query('SELECT vehicle_id, policy_id, payout_amount FROM insurance_claims WHERE id = ?')
        .get(id) as {
        vehicle_id: string | null;
        policy_id: string;
        payout_amount: number;
      } | null) ?? null
    );
  }

  test('the claim row SURVIVES with vehicle_id nulled; policy link + payout are intact', async () => {
    const vehicleId = await seedVehicle();

    // Seed a policy (claims FK→policies is notNull cascade) and a claim referencing the vehicle.
    ctx.sqlite.run(
      `INSERT INTO insurance_policies (id, user_id, company, is_active) VALUES ('pol-claim', ?, 'Geico', 1)`,
      [ctx.user.id]
    );
    ctx.sqlite.run(
      `INSERT INTO insurance_claims (id, policy_id, vehicle_id, claim_date, claim_type, status, payout_amount)
       VALUES ('clm-1', 'pol-claim', ?, 1700000000, 'collision', 'settled', 2500.0)`,
      [vehicleId]
    );
    expect(claimRow('clm-1')?.vehicle_id).toBe(vehicleId);

    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${vehicleId}`);
    expect(del.status, await del.text()).toBe(200);

    // The financial record must NOT be lost: row survives, vehicle_id is nulled, policy + payout untouched.
    const after = claimRow('clm-1');
    expect(after, 'claim must survive vehicle delete (set null, not cascade)').not.toBeNull();
    expect(after?.vehicle_id).toBeNull();
    expect(after?.policy_id).toBe('pol-claim');
    expect(after?.payout_amount).toBe(2500.0);
  });
});
