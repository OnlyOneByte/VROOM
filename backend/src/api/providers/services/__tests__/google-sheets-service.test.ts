import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
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
    expect(data.trips[0].startOdometer, 'cells are read raw; coerceRow types them').toBe('24000');
    const { coerceRow } = await import('../../../sync/backup');
    const trip = coerceRow(data.trips[0], schema.trips);
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

describe('GoogleSheetsService.readSpreadsheetData — restore integrity', () => {
  async function seedPolicyWithText(values: Record<string, string>): Promise<void> {
    const { db } = await import('../../../../db/connection');
    const schema = await import('../../../../db/schema');
    const [vehicle] = await db
      .insert(schema.vehicles)
      .values({ userId: ctx.user.id, make: 'Toyota', model: 'Corolla', year: 2015 })
      .returning();
    const [policy] = await db
      .insert(schema.insurancePolicies)
      .values({ userId: ctx.user.id, company: 'Acme' })
      .returning();
    await db.insert(schema.insuranceTerms).values({
      policyId: policy.id,
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-12-31T00:00:00.000Z'),
      ...values,
    });
    await db.insert(schema.trips).values({
      userId: ctx.user.id,
      vehicleId: vehicle.id,
      tripDate: new Date('2026-02-03T10:00:00.000Z'),
      startOdometer: 100,
      endOdometer: 150,
      purpose: 'business',
    });
  }

  async function restoreFromSheetsWith(
    svc: InstanceType<GoogleSheetsServiceCtor>,
    spreadsheetId: string,
    mode: 'replace' | 'preview'
  ): Promise<unknown> {
    ctx.sqlite.run(
      `INSERT OR IGNORE INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
       VALUES ('prov-sheets', ?, 'storage', 'google-drive', 'Drive', 'x', 'active')`,
      [ctx.user.id]
    );
    ctx.sqlite.run(
      'INSERT INTO user_preferences (user_id, backup_config) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET backup_config = excluded.backup_config',
      [
        ctx.user.id,
        JSON.stringify({ providers: { 'prov-sheets': { sheetsSpreadsheetId: spreadsheetId } } }),
      ]
    );
    const sheetsModule = await import('../google-sheets-service');
    const spy = spyOn(sheetsModule, 'createSheetsServiceForProvider').mockResolvedValue(svc);
    try {
      const { restoreService } = await import('../../../sync/restore');
      return await restoreService.restoreFromSheets(ctx.user.id, 'prov-sheets', mode);
    } finally {
      spy.mockRestore();
    }
  }

  test('a transient read error on an optional tab fails the restore instead of wiping that table', async () => {
    await seedPolicyWithText({ policyNumber: 'P-1' });
    const svc = makeSvc();
    const info = await svc.createOrUpdateVroomSpreadsheet(ctx.user.id, 'VROOM', 'Demo User');
    const tripsBefore = ctx.sqlite.query('SELECT COUNT(*) AS n FROM trips').get() as { n: number };
    expect(tripsBefore.n).toBe(1);

    const realRead = svc.readSheetData.bind(svc);
    spyOn(svc, 'readSheetData').mockImplementation((id: string, range: string) =>
      range.startsWith('Trips!')
        ? Promise.reject(googleApiError(429, 'Rate limit'))
        : realRead(id, range)
    );

    await expect(svc.readSpreadsheetData(info.id)).rejects.toThrow('Rate limit');
    await expect(restoreFromSheetsWith(svc, info.id, 'replace')).rejects.toThrow('Rate limit');

    const tripsAfter = ctx.sqlite.query('SELECT COUNT(*) AS n FROM trips').get() as { n: number };
    expect(tripsAfter.n, 'trips survive a failed Sheets restore').toBe(1);
  });

  test('an older spreadsheet without an optional tab still restores, with that table empty', async () => {
    await seedPolicyWithText({ policyNumber: 'P-2' });
    const svc = makeSvc();
    const info = await svc.createOrUpdateVroomSpreadsheet(ctx.user.id, 'VROOM', 'Demo User');
    const ss = store.spreadsheets.get(info.id);
    if (!ss) throw new Error('spreadsheet missing');
    ss.sheets = ss.sheets.filter((s) => s.title !== 'Trips' && s.title !== 'Vehicle Shares');
    ss.values.delete('Trips');
    ss.values.delete('Vehicle Shares');

    const data = await svc.readSpreadsheetData(info.id);
    expect(data.trips).toEqual([]);
    expect(data.vehicleShares).toEqual([]);
    expect(data.vehicles).toHaveLength(1);
  });

  test('numeric-looking text survives a Sheets backup and restore verbatim', async () => {
    const text = {
      policyNumber: '000123',
      agentPhone: '0412345678',
      agentName: '0x1A',
      coverageDescription: '1e3',
      agentEmail: '12345678901234567890',
    };
    await seedPolicyWithText(text);
    const svc = makeSvc();
    const info = await svc.createOrUpdateVroomSpreadsheet(ctx.user.id, 'VROOM', 'Demo User');

    const result = (await restoreFromSheetsWith(svc, info.id, 'replace')) as { success: boolean };
    expect(result.success, JSON.stringify(result)).toBe(true);

    const row = ctx.sqlite
      .query(
        'SELECT policy_number, agent_phone, agent_name, coverage_description, agent_email FROM insurance_terms'
      )
      .get();
    expect(row).toEqual({
      policy_number: '000123',
      agent_phone: '0412345678',
      agent_name: '0x1A',
      coverage_description: '1e3',
      agent_email: '12345678901234567890',
    });
    const trip = ctx.sqlite
      .query('SELECT trip_date, start_odometer, end_odometer FROM trips')
      .get() as { trip_date: number; start_odometer: number; end_odometer: number };
    expect(trip.start_odometer).toBe(100);
    expect(trip.end_odometer).toBe(150);
  });
});

describe('GoogleSheetsService — tabs wider than 26 columns', () => {
  test('columnLetter follows A1 notation past Z', async () => {
    const { columnLetter } = await import('../google-sheets-service');
    expect([1, 26, 27, 52, 53, 702, 703].map(columnLetter)).toEqual([
      'A',
      'Z',
      'AA',
      'AZ',
      'BA',
      'ZZ',
      'AAA',
    ]);
  });

  test('a tab with more than 26 headers writes and reads back every column', async () => {
    await seedVehicle('Mazda', 'MX-5', 2016);
    const sheetsModule = await import('../google-sheets-service');
    const headers = sheetsModule.SHEET_HEADERS.vehicles as unknown as string[];
    const originalLength = headers.length;
    const extra = Array.from({ length: 27 - originalLength + 2 }, (_, i) => `extraColumn${i}`);
    headers.push(...extra);
    try {
      const svc = makeSvc();
      const info = await svc.createOrUpdateVroomSpreadsheet(ctx.user.id, 'VROOM', 'Demo User');
      const data = await svc.readSpreadsheetData(info.id);
      expect(headers.length).toBeGreaterThan(26);
      expect(data.vehicles).toHaveLength(1);
      expect(Object.keys(data.vehicles[0])).toEqual(headers);
      expect(data.vehicles[0].make).toBe('Mazda');
    } finally {
      headers.splice(originalLength);
    }
  });
});

describe('GoogleSheetsService — user-edited tabs', () => {
  test('a column the user inserts into a tab does not push a real column out of the read', async () => {
    await seedVehicle('Skoda', 'Octavia', 2018);
    const svc = makeSvc();
    const info = await svc.createOrUpdateVroomSpreadsheet(ctx.user.id, 'VROOM', 'Demo User');
    const grid = store.spreadsheets.get(info.id)?.values.get('Vehicles');
    if (!grid) throw new Error('Vehicles tab missing');
    for (const row of grid) row.splice(1, 0, row === grid[0] ? 'My notes' : 'scratch');
    const lastHeader = String(grid[0][grid[0].length - 1]);

    const data = await svc.readSpreadsheetData(info.id);
    expect(data.vehicles).toHaveLength(1);
    expect(Object.keys(data.vehicles[0])).toContain(lastHeader);
    expect(data.vehicles[0].make).toBe('Skoda');
  });
});

describe('GoogleSheetsService — Sheets mirror version (Metadata tab)', () => {
  async function mirrorWithExpense(): Promise<{
    svc: InstanceType<GoogleSheetsServiceCtor>;
    spreadsheetId: string;
  }> {
    await seedVehicle('Opel', 'Astra', 2011);
    const vehicle = ctx.sqlite.query('SELECT id FROM vehicles').get() as { id: string };
    ctx.sqlite.run(
      `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount)
       VALUES ('exp-sheet', ?, ?, 'fuel', 1700000000, 4550),
              ('exp-sheet-2', ?, ?, 'fuel', 1700000001, 9900)`,
      [vehicle.id, ctx.user.id, vehicle.id, ctx.user.id]
    );
    const svc = makeSvc();
    const info = await svc.createOrUpdateVroomSpreadsheet(ctx.user.id, 'VROOM', 'Demo User');
    return { svc, spreadsheetId: info.id };
  }

  function expensesGrid(spreadsheetId: string): (string | number | boolean)[][] {
    const grid = store.spreadsheets.get(spreadsheetId)?.values.get('Expenses');
    if (!grid) throw new Error('Expenses tab missing');
    return grid;
  }

  function setExpenseAmountCell(spreadsheetId: string, expenseId: string, value: string): void {
    const grid = expensesGrid(spreadsheetId);
    const row = grid.find((r) => r[grid[0].indexOf('id')] === expenseId);
    if (!row) throw new Error(`expense ${expenseId} missing`);
    row[grid[0].indexOf('expenseAmount')] = value;
  }

  function dropExpenseColumn(spreadsheetId: string, header: string): void {
    const grid = expensesGrid(spreadsheetId);
    const index = grid[0].indexOf(header);
    for (const row of grid) row.splice(index, 1);
  }

  function dropMetadataTab(spreadsheetId: string): void {
    const ss = store.spreadsheets.get(spreadsheetId);
    if (!ss) throw new Error('spreadsheet missing');
    ss.sheets = ss.sheets.filter((s) => s.title !== 'Metadata');
    ss.values.delete('Metadata');
  }

  async function restoredExpenseAmount(
    svc: InstanceType<GoogleSheetsServiceCtor>,
    spreadsheetId: string,
    expenseId = 'exp-sheet'
  ): Promise<number> {
    ctx.sqlite.run(
      `INSERT OR IGNORE INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
       VALUES ('prov-meta', ?, 'storage', 'google-drive', 'Drive', 'x', 'active')`,
      [ctx.user.id]
    );
    ctx.sqlite.run(
      'INSERT INTO user_preferences (user_id, backup_config) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET backup_config = excluded.backup_config',
      [
        ctx.user.id,
        JSON.stringify({ providers: { 'prov-meta': { sheetsSpreadsheetId: spreadsheetId } } }),
      ]
    );
    const sheetsModule = await import('../google-sheets-service');
    const spy = spyOn(sheetsModule, 'createSheetsServiceForProvider').mockResolvedValue(svc);
    try {
      const { restoreService } = await import('../../../sync/restore');
      const result = await restoreService.restoreFromSheets(ctx.user.id, 'prov-meta', 'replace');
      expect(result.success, JSON.stringify(result)).toBe(true);
    } finally {
      spy.mockRestore();
    }
    return (
      ctx.sqlite.query('SELECT expense_amount FROM expenses WHERE id = ?').get(expenseId) as {
        expense_amount: number;
      }
    ).expense_amount;
  }

  test('every sync writes a Metadata tab with the backup version and owner', async () => {
    const { spreadsheetId } = await mirrorWithExpense();
    const grid = store.spreadsheets.get(spreadsheetId)?.values.get('Metadata');
    const { CONFIG } = await import('../../../../config');
    expect(grid?.[0]).toEqual(['version', 'timestamp', 'userId']);
    expect(grid?.[1]?.[0]).toBe(CONFIG.backup.currentVersion);
    expect(grid?.[1]?.[2]).toBe(ctx.user.id);
  });

  test('a mirror whose Metadata says 1.x is restored from dollars to cents', async () => {
    const { svc, spreadsheetId } = await mirrorWithExpense();
    const grid = store.spreadsheets.get(spreadsheetId)?.values.get('Metadata');
    if (!grid) throw new Error('Metadata tab missing');
    grid[1][0] = '1.0.0';
    setExpenseAmountCell(spreadsheetId, 'exp-sheet', '12');

    expect(await restoredExpenseAmount(svc, spreadsheetId)).toBe(1200);
  });

  test('a mirror in the 1.x layout (no Metadata tab, no createdBy column) is restored to cents', async () => {
    const { svc, spreadsheetId } = await mirrorWithExpense();
    dropMetadataTab(spreadsheetId);
    dropExpenseColumn(spreadsheetId, 'createdBy');
    setExpenseAmountCell(spreadsheetId, 'exp-sheet', '12.34');

    expect(await restoredExpenseAmount(svc, spreadsheetId)).toBe(1234);
  });

  test('one hand-edited decimal cell in a cents mirror does not rescale every amount', async () => {
    const { svc, spreadsheetId } = await mirrorWithExpense();
    dropMetadataTab(spreadsheetId);
    setExpenseAmountCell(spreadsheetId, 'exp-sheet', '45.50');

    expect(await restoredExpenseAmount(svc, spreadsheetId, 'exp-sheet-2')).toBe(9900);
  });

  test('a mirror without a Metadata tab written in cents restores unchanged', async () => {
    const { svc, spreadsheetId } = await mirrorWithExpense();
    dropMetadataTab(spreadsheetId);

    expect(await restoredExpenseAmount(svc, spreadsheetId)).toBe(4550);
  });
});
