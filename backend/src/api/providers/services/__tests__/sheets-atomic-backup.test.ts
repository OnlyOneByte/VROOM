import { beforeEach, describe, expect, test } from 'bun:test';
import {
  FakeGoogleStore,
  googleApiError,
  makeFakeSheetsClients,
} from '../../../../test-helpers/fake-google-clients';
import { createTestApp, type TestApp } from '../../../../test-helpers/http-client';

type SheetsModule = typeof import('../google-sheets-service');

let ctx: TestApp;
let store: FakeGoogleStore;
let mod: SheetsModule;

beforeEach(async () => {
  ctx = await createTestApp();
  store = new FakeGoogleStore();
  mod = await import('../google-sheets-service');
});

function makeSvc() {
  return new mod.GoogleSheetsService('fake-refresh-token', makeFakeSheetsClients(store));
}

function backup() {
  return makeSvc().createOrUpdateVroomSpreadsheet(ctx.user.id, 'VROOM/Backups', 'Demo User');
}

async function seedVehicle(make: string): Promise<void> {
  const { db } = await import('../../../../db/connection');
  const schema = await import('../../../../db/schema');
  await db
    .insert(schema.vehicles)
    .values({ userId: ctx.user.id, make, model: 'Civic', year: 2021 });
}

async function backupWithFailedSwap(): Promise<string> {
  await seedVehicle('Toyota');
  const info = await backup();
  await seedVehicle('Honda');
  store.injectFault('spreadsheets.batchUpdate', googleApiError(500, 'swap failed'), 1, 1);
  await expect(backup()).rejects.toThrow('swap failed');
  return info.id;
}

describe('Sheets backup is atomic — stage-then-swap', () => {
  test('a re-backup never clears a live tab in place', async () => {
    await seedVehicle('Toyota');
    const info = await backup();

    store.injectFault('spreadsheets.values.clear', googleApiError(500, 'live tab cleared'), 1000);
    await seedVehicle('Honda');
    await backup();

    const data = await makeSvc().readSpreadsheetData(info.id);
    expect(data.vehicles.map((v) => v.make).sort()).toEqual(['Honda', 'Toyota']);
  });

  test('a failure during the swap leaves the previous backup readable', async () => {
    const id = await backupWithFailedSwap();

    const data = await makeSvc().readSpreadsheetData(id);
    expect(data.vehicles.map((v) => v.make)).toEqual(['Toyota']);
  });

  test('the next backup recovers from an interrupted swap and restores the tab roster', async () => {
    const id = await backupWithFailedSwap();

    await backup();

    const svc = makeSvc();
    const data = await svc.readSpreadsheetData(id);
    expect(data.vehicles.map((v) => v.make).sort()).toEqual(['Honda', 'Toyota']);
    const titles = (await svc.getSpreadsheetInfo(id)).sheets.map((s) => s.title);
    expect(titles.some((t) => t.includes(mod.SHEET_STAGING_SUFFIX))).toBe(false);
    expect(titles).toEqual([...mod.SHEET_NAMES]);
  });

  test('the staging suffix is non-empty and space-free (it is spliced unquoted into A1 ranges)', () => {
    expect(mod.SHEET_STAGING_SUFFIX).toMatch(/^\S+$/);
  });
});
