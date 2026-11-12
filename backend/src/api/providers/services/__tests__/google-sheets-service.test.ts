import { beforeEach, describe, expect, test } from 'bun:test';
import {
  FakeGoogleStore,
  googleApiError,
  idOf,
  makeFakeSheetsClients,
} from '../../../../test-helpers/fake-google-clients';
import { createTestApp, type TestApp } from '../../../../test-helpers/http-client';

type GoogleSheetsServiceCtor = typeof import('../google-sheets-service').GoogleSheetsService;

let ctx: TestApp;
let store: FakeGoogleStore;
let GoogleSheetsService: GoogleSheetsServiceCtor;
let SHEET_NAMES: readonly string[];
let makeSvc: () => InstanceType<GoogleSheetsServiceCtor>;

beforeEach(async () => {
  ctx = await createTestApp();
  store = new FakeGoogleStore();
  ({ GoogleSheetsService, SHEET_NAMES } = await import('../google-sheets-service'));
  makeSvc = () => new GoogleSheetsService('fake-refresh-token', makeFakeSheetsClients(store));
});

async function seedVehicle(make = 'Toyota', model = 'Camry', year = 2020): Promise<void> {
  const { db } = await import('../../../../db/connection');
  const schema = await import('../../../../db/schema');
  await db.insert(schema.vehicles).values({ userId: ctx.user.id, make, model, year });
}

describe('GoogleSheetsService.createOrUpdateVroomSpreadsheet', () => {
  test('creates the folder path, the spreadsheet, and moves it into the leaf folder', async () => {
    const info = await makeSvc().createOrUpdateVroomSpreadsheet(
      ctx.user.id,
      'VROOM/Backups',
      'Demo User'
    );

    expect(info.name).toBe('VROOM Data - Demo User');
    expect(info.webViewLink).toContain(info.id);
    expect(info.sheets.map((s) => s.title)).toEqual([...SHEET_NAMES]);
    expect(info.sheets).toHaveLength(SHEET_NAMES.length);

    const vroom = [...store.files.values()].find(
      (f) => f.name === 'VROOM' && f.mimeType === 'application/vnd.google-apps.folder'
    );
    const backups = [...store.files.values()].find(
      (f) => f.name === 'Backups' && f.mimeType === 'application/vnd.google-apps.folder'
    );
    expect(vroom).toBeDefined();
    expect(backups?.parents).toEqual([idOf(vroom)]);

    const sheetFile = store.files.get(info.id);
    expect(sheetFile?.parents).toEqual([idOf(backups)]);
    expect(sheetFile?.parents).not.toContain('root');
  });

  test('reuses an existing VROOM folder instead of duplicating it', async () => {
    store.seedFolder('VROOM');
    await makeSvc().createOrUpdateVroomSpreadsheet(ctx.user.id, 'VROOM/Backups', 'Demo User');

    const vroomFolders = [...store.files.values()].filter(
      (f) => f.name === 'VROOM' && f.mimeType === 'application/vnd.google-apps.folder'
    );
    expect(vroomFolders).toHaveLength(1);
  });

  test('is idempotent — a second call reuses the same spreadsheet', async () => {
    const svc = makeSvc();
    const first = await svc.createOrUpdateVroomSpreadsheet(
      ctx.user.id,
      'VROOM/Backups',
      'Demo User'
    );
    const second = await svc.createOrUpdateVroomSpreadsheet(
      ctx.user.id,
      'VROOM/Backups',
      'Demo User'
    );

    expect(second.id).toBe(first.id);
    const spreadsheetFiles = [...store.files.values()].filter(
      (f) => f.mimeType === 'application/vnd.google-apps.spreadsheet'
    );
    expect(spreadsheetFiles).toHaveLength(1);
  });

  test('writes the user’s vehicle rows into the Vehicles sheet', async () => {
    await seedVehicle('Toyota', 'Camry', 2020);
    const info = await makeSvc().createOrUpdateVroomSpreadsheet(
      ctx.user.id,
      'VROOM/Backups',
      'Demo User'
    );

    const grid = store.spreadsheets.get(info.id)?.values.get('Vehicles');
    expect(grid).toBeDefined();
    expect(grid).toHaveLength(2);
    expect(grid?.[0]).toContain('make');
    expect(JSON.stringify(grid?.[1])).toContain('Toyota');
    expect(JSON.stringify(grid?.[1])).toContain('Camry');
  });

  test('only the owner’s data is written (user-scoping)', async () => {
    const { db } = await import('../../../../db/connection');
    const schema = await import('../../../../db/schema');
    await db
      .insert(schema.users)
      .values({ id: 'other-user', email: 'other@x.com', displayName: 'Other' });
    await db
      .insert(schema.vehicles)
      .values({ userId: 'other-user', make: 'Tesla', model: 'S', year: 2023 });
    await seedVehicle('Toyota', 'Camry', 2020);

    const info = await makeSvc().createOrUpdateVroomSpreadsheet(ctx.user.id, 'VROOM', 'Demo User');
    const grid = store.spreadsheets.get(info.id)?.values.get('Vehicles');

    expect(grid).toHaveLength(2);
    expect(JSON.stringify(grid)).toContain('Toyota');
    expect(JSON.stringify(grid)).not.toContain('Tesla');
  });
});

describe('GoogleSheetsService.readSpreadsheetData', () => {
  test('round-trips written data back into parsed records', async () => {
    await seedVehicle('Honda', 'Civic', 2019);
    const svc = makeSvc();
    const info = await svc.createOrUpdateVroomSpreadsheet(
      ctx.user.id,
      'VROOM/Backups',
      'Demo User'
    );

    const data = await svc.readSpreadsheetData(info.id);
    expect(data.vehicles).toHaveLength(1);
    expect(data.vehicles[0].make).toBe('Honda');
    expect(data.vehicles[0].model).toBe('Civic');
    expect(data.metadata.userId).toBe(ctx.user.id);
  });

  test('a non-default themePreference survives the Sheets export→read round-trip', async () => {
    await seedVehicle('Honda', 'Civic', 2019);
    const { db } = await import('../../../../db/connection');
    const schema = await import('../../../../db/schema');
    await db.insert(schema.userPreferences).values({
      userId: ctx.user.id,
      themePreference: 'instrument',
    });

    const svc = makeSvc();
    const info = await svc.createOrUpdateVroomSpreadsheet(
      ctx.user.id,
      'VROOM/Backups',
      'Demo User'
    );

    const grid = store.spreadsheets.get(info.id)?.values.get('User Preferences');
    const headerRow = grid?.[0] ?? [];
    const themeCol = headerRow.indexOf('themePreference');
    expect(themeCol, 'themePreference column present in the Sheets export').toBeGreaterThanOrEqual(
      0
    );
    expect(grid?.[1]?.[themeCol]).toBe('instrument');

    const data = await svc.readSpreadsheetData(info.id);
    expect(data.userPreferences).toHaveLength(1);
    expect(data.userPreferences[0].themePreference).toBe('instrument');
  });

  test('a trip (with a non-midnight tripDate) survives the Sheets export→read round-trip', async () => {
    const { db } = await import('../../../../db/connection');
    const schema = await import('../../../../db/schema');
    const [veh] = await db
      .insert(schema.vehicles)
      .values({ userId: ctx.user.id, make: 'Toyota', model: 'Camry', year: 2022 })
      .returning();
    const tripDate = new Date(Date.UTC(2024, 5, 20, 13, 30, 0));
    await db.insert(schema.trips).values({
      vehicleId: veh.id,
      userId: ctx.user.id,
      startOdometer: 24000,
      endOdometer: 24135,
      purpose: 'business',
      tripDate,
      startLocation: 'Office',
      note: 'Q2 review',
    });

    const svc = makeSvc();
    const info = await svc.createOrUpdateVroomSpreadsheet(
      ctx.user.id,
      'VROOM/Backups',
      'Demo User'
    );

    const grid = store.spreadsheets.get(info.id)?.values.get('Trips');
    const headerRow = grid?.[0] ?? [];
    const dateCol = headerRow.indexOf('tripDate');
    expect(dateCol, 'tripDate column present in the Sheets export').toBeGreaterThanOrEqual(0);
    expect(grid?.[1]?.[dateCol]).toBe('2024-06-20T13:30:00.000Z');

    const data = await svc.readSpreadsheetData(info.id);
    expect(data.trips).toHaveLength(1);
    const trip = data.trips[0];
    expect(trip.vehicleId).toBe(veh.id);
    expect(trip.startOdometer).toBe(24000);
    expect(trip.endOdometer).toBe(24135);
    expect(trip.purpose).toBe('business');
    expect((trip.tripDate as Date).toISOString()).toBe('2024-06-20T13:30:00.000Z');
    expect(trip.startLocation).toBe('Office');
    expect(trip.endLocation).toBeNull();
    expect(trip.note).toBe('Q2 review');
  });
});

describe('GoogleSheetsService — formula-injection safety', () => {
  test('writes every sheet with valueInputOption RAW (not USER_ENTERED)', async () => {
    await seedVehicle('Toyota', 'Camry', 2020);
    const info = await makeSvc().createOrUpdateVroomSpreadsheet(
      ctx.user.id,
      'VROOM/Backups',
      'Demo User'
    );

    const ss = store.spreadsheets.get(info.id);
    expect(ss).toBeDefined();
    const opts = [...(ss?.valueInputOptions.values() ?? [])];
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every((o) => o === 'RAW')).toBe(true);
    expect(opts).not.toContain('USER_ENTERED');
  });

  test('a make beginning with "=" round-trips VERBATIM (stored inert, not a formula)', async () => {
    const formula = '=HYPERLINK("http://evil","x")';
    await seedVehicle(formula, 'Civic', 2019);
    const svc = makeSvc();
    const info = await svc.createOrUpdateVroomSpreadsheet(
      ctx.user.id,
      'VROOM/Backups',
      'Demo User'
    );

    const grid = store.spreadsheets.get(info.id)?.values.get('Vehicles');
    const makeCol = (grid?.[0] ?? []).indexOf('make');
    expect(makeCol).toBeGreaterThanOrEqual(0);
    expect(grid?.[1]?.[makeCol]).toBe(formula);

    const data = await svc.readSpreadsheetData(info.id);
    expect(data.vehicles[0].make).toBe(formula);
  });
});

describe('GoogleSheetsService — error/resilience paths', () => {
  test('a failed spreadsheet create surfaces the API error', async () => {
    store.injectFault('spreadsheets.create', googleApiError(403, 'Insufficient permissions'));
    await expect(
      makeSvc().createOrUpdateVroomSpreadsheet(ctx.user.id, 'VROOM/Backups', 'Demo User')
    ).rejects.toThrow('Insufficient permissions');
  });

  test('a 429 while writing a sheet propagates (caller decides retry)', async () => {
    store.injectFault('spreadsheets.values.update', googleApiError(429, 'Rate limit exceeded'));
    await expect(
      makeSvc().createOrUpdateVroomSpreadsheet(ctx.user.id, 'VROOM/Backups', 'Demo User')
    ).rejects.toThrow('Rate limit exceeded');
  });
});

describe('GoogleSheetsService — atomic backup swap', () => {
  test('a write failure during a re-backup leaves the previous backup intact (no torn/emptied data)', async () => {
    await seedVehicle('Toyota', 'Camry', 2020);
    const svc = makeSvc();
    const info = await svc.createOrUpdateVroomSpreadsheet(
      ctx.user.id,
      'VROOM/Backups',
      'Demo User'
    );
    const before = await svc.readSpreadsheetData(info.id);
    expect(before.vehicles).toHaveLength(1);
    expect(before.vehicles[0].make).toBe('Toyota');

    const { db } = await import('../../../../db/connection');
    const schema = await import('../../../../db/schema');
    await db.insert(schema.vehicles).values({
      userId: ctx.user.id,
      make: 'Honda',
      model: 'Civic',
      year: 2021,
    });
    store.injectFault('spreadsheets.values.update', googleApiError(429, 'Rate limit exceeded'));
    await expect(
      svc.createOrUpdateVroomSpreadsheet(ctx.user.id, 'VROOM/Backups', 'Demo User')
    ).rejects.toThrow('Rate limit exceeded');

    const after = await svc.readSpreadsheetData(info.id);
    expect(after.vehicles).toHaveLength(1);
    expect(after.vehicles[0].make).toBe('Toyota');

    const titles = (await svc.getSpreadsheetInfo(info.id)).sheets.map((s) => s.title);
    expect(titles.some((t) => t.includes('__vroom_staging'))).toBe(false);
    expect(titles).toEqual([...SHEET_NAMES]);
  });

  test('a successful re-backup replaces the data and keeps tab order stable', async () => {
    await seedVehicle('Toyota', 'Camry', 2020);
    const svc = makeSvc();
    const info = await svc.createOrUpdateVroomSpreadsheet(
      ctx.user.id,
      'VROOM/Backups',
      'Demo User'
    );
    const firstTitles = (await svc.getSpreadsheetInfo(info.id)).sheets.map((s) => s.title);

    const { db } = await import('../../../../db/connection');
    const schema = await import('../../../../db/schema');
    await db.insert(schema.vehicles).values({
      userId: ctx.user.id,
      make: 'Honda',
      model: 'Civic',
      year: 2021,
    });
    await svc.createOrUpdateVroomSpreadsheet(ctx.user.id, 'VROOM/Backups', 'Demo User');

    const after = await svc.readSpreadsheetData(info.id);
    expect(after.vehicles).toHaveLength(2);
    expect(after.vehicles.map((v) => v.make).sort()).toEqual(['Honda', 'Toyota']);

    const secondTitles = (await svc.getSpreadsheetInfo(info.id)).sheets.map((s) => s.title);
    expect(secondTitles).toEqual(firstTitles);
    expect(secondTitles).toEqual([...SHEET_NAMES]);
  });
});
