/**
 * GoogleSheetsService against in-memory fake Sheets + Drive clients (injected via
 * the constructor seam — NO `mock.module`). One shared FakeGoogleStore keeps the
 * Sheets and Drive surfaces coherent, so the real service logic runs end to end:
 * folder-path walk → find-or-create spreadsheet → move into folder → clear+write
 * every sheet → read back. This is the backup-to-Sheets path with zero network.
 *
 * Needs the DB (updateSpreadsheetWithUserData reads the user's rows via getDb()),
 * so it bootstraps the blessed `createTestApp()` harness (:memory: + migrations +
 * seeded user). GoogleSheetsService pulls in db/connection (module-load DB bind),
 * so it is DYNAMIC-imported AFTER createTestApp() sets DATABASE_URL — same
 * load-order rule the HTTP harness documents.
 *
 * Pattern doc: .kiro/steering/TestingExternalAPIs.md
 */

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
let makeSvc: () => InstanceType<GoogleSheetsServiceCtor>;

beforeEach(async () => {
  ctx = await createTestApp();
  store = new FakeGoogleStore();
  ({ GoogleSheetsService } = await import('../google-sheets-service'));
  makeSvc = () => new GoogleSheetsService('fake-refresh-token', makeFakeSheetsClients(store));
});

/** Seed one vehicle for the test user so a non-empty sheet is exercised. */
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
    // 15 sheets created up front (added Insurance Claims)
    expect(info.sheets.map((s) => s.title)).toContain('Vehicles');
    expect(info.sheets.map((s) => s.title)).toContain('Insurance Claims');
    expect(info.sheets).toHaveLength(15);

    // The folder path was created: one VROOM, one Backups nested under it.
    const vroom = [...store.files.values()].find(
      (f) => f.name === 'VROOM' && f.mimeType === 'application/vnd.google-apps.folder'
    );
    const backups = [...store.files.values()].find(
      (f) => f.name === 'Backups' && f.mimeType === 'application/vnd.google-apps.folder'
    );
    expect(vroom).toBeDefined();
    expect(backups?.parents).toEqual([idOf(vroom)]);

    // The spreadsheet was MOVED into Backups (root removed, Backups added).
    const sheetFile = store.files.get(info.id);
    expect(sheetFile?.parents).toEqual([idOf(backups)]);
    expect(sheetFile?.parents).not.toContain('root');
  });

  test('reuses an existing VROOM folder instead of duplicating it', async () => {
    store.seedFolder('VROOM'); // pre-existing top-level folder
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
    // header row + 1 data row
    expect(grid).toHaveLength(2);
    expect(grid?.[0]).toContain('make');
    expect(JSON.stringify(grid?.[1])).toContain('Toyota');
    expect(JSON.stringify(grid?.[1])).toContain('Camry');
  });

  test('only the owner’s data is written (user-scoping)', async () => {
    // A second user with their own vehicle must not leak into this user's sheet.
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

    expect(grid).toHaveLength(2); // header + only the owner's 1 vehicle
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
});

describe('GoogleSheetsService — formula-injection safety (#36)', () => {
  // The backup writes must use RAW, not USER_ENTERED — otherwise a cell value beginning with a formula
  // trigger (=,+,-,@) is parsed as a live formula by Sheets (injection + the user's OWN data silently
  // round-trips back as the formula RESULT, not the text they stored). The fake records grids identically
  // regardless of the option, so a plain round-trip can't catch a regression — assert the option directly.
  test('writes every sheet with valueInputOption RAW (not USER_ENTERED)', async () => {
    await seedVehicle('Toyota', 'Camry', 2020);
    const info = await makeSvc().createOrUpdateVroomSpreadsheet(
      ctx.user.id,
      'VROOM/Backups',
      'Demo User'
    );

    const ss = store.spreadsheets.get(info.id);
    expect(ss).toBeDefined();
    // At least the Vehicles sheet was written; whatever was written used RAW.
    const opts = [...(ss?.valueInputOptions.values() ?? [])];
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every((o) => o === 'RAW')).toBe(true);
    expect(opts).not.toContain('USER_ENTERED');
  });

  test('a make beginning with "=" round-trips VERBATIM (stored inert, not a formula)', async () => {
    // A maliciously- or accidentally-formula-shaped value must survive backup→restore byte-exact.
    const formula = '=HYPERLINK("http://evil","x")';
    await seedVehicle(formula, 'Civic', 2019);
    const svc = makeSvc();
    const info = await svc.createOrUpdateVroomSpreadsheet(
      ctx.user.id,
      'VROOM/Backups',
      'Demo User'
    );

    // Stored cell is the literal text (no leading-quote escaping added on this round-trip path) —
    // assert against the actual cell, NOT a JSON.stringify substring (which escapes the inner quotes).
    const grid = store.spreadsheets.get(info.id)?.values.get('Vehicles');
    const makeCol = (grid?.[0] ?? []).indexOf('make');
    expect(makeCol).toBeGreaterThanOrEqual(0);
    expect(grid?.[1]?.[makeCol]).toBe(formula);

    // And it reads back as exactly that string (parseValue leaves a non-numeric/non-date string as-is).
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
