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

function catalogIds(): (string | null)[] {
  return (
    ctx.sqlite
      .query('SELECT catalog_model_id FROM vehicles WHERE user_id = ? ORDER BY make')
      .all(ctx.user.id) as { catalog_model_id: string | null }[]
  ).map((row) => row.catalog_model_id);
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

describe('backup → restore round-trip of vehicles.catalog_model_id', () => {
  test('a set id and a null id both survive', async () => {
    await createVehicle({ make: 'Honda', model: 'Civic', catalogModelId: 'honda-civic' });
    await createVehicle({ make: 'Zastava', model: 'Yugo' });
    expect(catalogIds()).toEqual(['honda-civic', null]);

    await roundTrip();

    expect(catalogIds()).toEqual(['honda-civic', null]);
  });

  test('an id the catalogue does not know restores as null', async () => {
    const id = await createVehicle({ make: 'Honda', model: 'Civic' });
    ctx.sqlite.query('UPDATE vehicles SET catalog_model_id = ? WHERE id = ?').run('gone-model', id);

    await roundTrip();

    expect(catalogIds()).toEqual([null]);
  });
});
