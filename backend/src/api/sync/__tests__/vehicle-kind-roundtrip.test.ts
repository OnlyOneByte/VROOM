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

function kinds(): string[] {
  return (
    ctx.sqlite
      .query('SELECT vehicle_kind FROM vehicles WHERE user_id = ? ORDER BY make')
      .all(ctx.user.id) as { vehicle_kind: string }[]
  ).map((row) => row.vehicle_kind);
}

async function createVehicle(body: Record<string, unknown>): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', { year: 2019, ...body });
  const created = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(created)).toBe(201);
  return created.data.id;
}

async function roundTrip(): Promise<void> {
  const { backupService } = await import('../backup');
  const { restoreService } = await import('../restore');
  const zip = await backupService.exportAsZip(ctx.user.id);
  const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
  expect(result.success, JSON.stringify(result)).toBe(true);
}

describe('backup → restore round-trip of vehicles.vehicle_kind', () => {
  test('every kind survives', async () => {
    await createVehicle({ make: 'A Honda', model: 'Civic' });
    await createVehicle({ make: 'B Ducati', model: 'Monster', vehicleKind: 'motorcycle' });
    await createVehicle({ make: 'C Ford', model: 'Transit', vehicleKind: 'van' });
    await createVehicle({ make: 'D Ram', model: '2500', vehicleKind: 'truck' });
    await createVehicle({ make: 'E Winnebago', model: 'Travato', vehicleKind: 'rv' });
    await createVehicle({ make: 'F Polaris', model: 'Ranger', vehicleKind: 'other' });
    const expected = ['car', 'motorcycle', 'van', 'truck', 'rv', 'other'];
    expect(kinds()).toEqual(expected);

    await roundTrip();

    expect(kinds()).toEqual(expected);
  });

  test('a kind the app does not know restores as car', async () => {
    const id = await createVehicle({ make: 'Honda', model: 'Civic' });
    ctx.sqlite.query('UPDATE vehicles SET vehicle_kind = ? WHERE id = ?').run('hovercraft', id);

    await roundTrip();

    expect(kinds()).toEqual(['car']);
  });
});
