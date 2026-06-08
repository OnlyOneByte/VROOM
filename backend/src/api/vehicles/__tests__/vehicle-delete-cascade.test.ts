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
