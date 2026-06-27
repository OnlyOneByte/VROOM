/**
 * Google Sheets Service - Syncs VROOM data to Google Sheets
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { OAuth2Client } from 'google-auth-library';
import { type drive_v3, google, type sheets_v4 } from 'googleapis';
import { getDb } from '../../../db/connection';
import {
  expenses,
  insuranceClaims,
  insurancePolicies,
  insuranceTerms,
  insuranceTermVehicles,
  odometerEntries,
  photoRefs,
  photos,
  reminderNotifications,
  reminders,
  reminderVehicles,
  syncState,
  trips,
  userPreferences,
  vehicleFinancing,
  vehicleShares,
  vehicles,
} from '../../../db/schema';
import { SyncError, SyncErrorCode } from '../../../errors';
import { GoogleDriveService } from './google-drive-service';

/**
 * Per-table column order for every VROOM sheet, keyed by the SAME keys as
 * `TABLE_SCHEMA_MAP` in config.ts. These arrays are the single source of truth for the
 * Sheets backup/restore round-trip: the export writes row 0 = headers and each data row
 * = `headers.map((h) => row[h])`, and the import re-keys each cell off the sheet's own
 * header row. Because the order is hand-maintained (Sheets, unlike the CSV path, is not
 * schema-derived), a schema column that isn't mirrored here is SILENTLY DROPPED on backup
 * and restored as null — a data-loss bug. `sheets-header-coverage.test.ts` pins every
 * array to its schema as a regression guard; keep these in sync with db/schema.ts.
 */
export const SHEET_HEADERS = {
  vehicles: [
    'id',
    'userId',
    'make',
    'model',
    'year',
    'vehicleType',
    'trackFuel',
    'trackCharging',
    'licensePlate',
    'nickname',
    'vin',
    'initialMileage',
    'purchasePrice',
    'purchaseDate',
    'unitPreferences',
    'createdAt',
    'updatedAt',
  ],
  expenses: [
    'id',
    'vehicleId',
    'userId',
    'clientId',
    'tags',
    'category',
    'expenseAmount',
    'volume',
    'fuelType',
    'missedFillup',
    'date',
    'mileage',
    'description',
    'groupId',
    'groupTotal',
    'splitMethod',
    'sourceType',
    'sourceId',
    'createdAt',
    'updatedAt',
  ],
  insurance: ['id', 'userId', 'company', 'isActive', 'notes', 'createdAt', 'updatedAt'],
  insuranceTerms: [
    'id',
    'policyId',
    'startDate',
    'endDate',
    'policyNumber',
    'coverageDescription',
    'deductibleAmount',
    'coverageLimit',
    'agentName',
    'agentPhone',
    'agentEmail',
    'totalCost',
    'monthlyCost',
    'premiumFrequency',
    'paymentAmount',
    'createdAt',
    'updatedAt',
  ],
  insuranceTermVehicles: ['termId', 'vehicleId'],
  insuranceClaims: [
    'id',
    'policyId',
    'termId',
    'vehicleId',
    'claimDate',
    'claimType',
    'description',
    'status',
    'payoutAmount',
    'faultDesignation',
    'createdAt',
    'updatedAt',
  ],
  financing: [
    'id',
    'vehicleId',
    'financingType',
    'provider',
    'originalAmount',
    'apr',
    'termMonths',
    'startDate',
    'paymentAmount',
    'paymentFrequency',
    'paymentDayOfMonth',
    'paymentDayOfWeek',
    'residualValue',
    'mileageLimit',
    'excessMileageFee',
    'isActive',
    'endDate',
    'createdAt',
    'updatedAt',
  ],
  odometer: [
    'id',
    'vehicleId',
    'userId',
    'odometer',
    'recordedAt',
    'note',
    'createdAt',
    'updatedAt',
  ],
  photos: [
    'id',
    'userId',
    'entityType',
    'entityId',
    'fileName',
    'mimeType',
    'fileSize',
    'isCover',
    'sortOrder',
    'createdAt',
  ],
  photoRefs: [
    'id',
    'photoId',
    'providerId',
    'storageRef',
    'externalUrl',
    'status',
    'errorMessage',
    'retryCount',
    'syncedAt',
    'createdAt',
  ],
  userPreferences: [
    'userId',
    'unitPreferences',
    'currencyUnit',
    'themePreference',
    'businessMileageRate',
    'autoBackupEnabled',
    'backupFrequency',
    'syncOnInactivity',
    'syncInactivityMinutes',
    'storageConfig',
    'backupConfig',
    'createdAt',
    'updatedAt',
  ],
  syncState: ['userId', 'lastSyncDate', 'lastDataChangeDate', 'lastBackupDate'],
  reminders: [
    'id',
    'userId',
    'name',
    'description',
    'type',
    'actionMode',
    'frequency',
    'intervalValue',
    'intervalUnit',
    'triggerMode',
    'intervalMileage',
    'lastServiceOdometer',
    'nextDueOdometer',
    'startDate',
    'endDate',
    'nextDueDate',
    'expenseCategory',
    'expenseTags',
    'expenseAmount',
    'expenseDescription',
    'expenseSplitConfig',
    'isActive',
    'lastTriggeredAt',
    'createdAt',
    'updatedAt',
  ],
  reminderVehicles: ['reminderId', 'vehicleId'],
  reminderNotifications: [
    'id',
    'reminderId',
    'userId',
    'dueDate',
    'dueOdometer',
    'isRead',
    'createdAt',
    'updatedAt',
  ],
  trips: [
    'id',
    'vehicleId',
    'userId',
    'startOdometer',
    'endOdometer',
    'purpose',
    'tripDate',
    'startLocation',
    'endLocation',
    'note',
    'createdAt',
    'updatedAt',
  ],
  vehicleShares: [
    'id',
    'vehicleId',
    'ownerId',
    'sharedWithId',
    'level',
    'status',
    'createdAt',
    'updatedAt',
  ],
} as const satisfies Record<string, readonly string[]>;

/**
 * The canonical ordered roster of VROOM sheet TAB titles — ONE source of truth (C30) for the tab set
 * that `createSpreadsheet` (initial tabs) and `ensureRequiredSheets` (backfill missing tabs on an
 * existing spreadsheet) both need. Before this, the 15-tab list was hand-copied in BOTH places (plus the
 * read-range + write fan-out, which pair each title with table-specific logic and stay inline), so adding
 * a 16th table meant editing parallel lists in lockstep — a C161-class drift vector. These are display
 * tab TITLES (with spaces), distinct from the `SHEET_HEADERS` keys (camelCase) — kept ordered to match
 * the historical create order so existing spreadsheets are unaffected.
 */
export const SHEET_NAMES = [
  'Vehicles',
  'Expenses',
  'Insurance Policies',
  'Insurance Terms',
  'Insurance Term Vehicles',
  'Insurance Claims',
  'Vehicle Financing',
  'Odometer',
  'Photos',
  'Photo Refs',
  'User Preferences',
  'Sync State',
  'Reminders',
  'Reminder Vehicles',
  'Reminder Notifications',
  'Trips',
  'Vehicle Shares',
] as const;

/**
 * Suffix for the transient per-table tabs used by the atomic backup swap (#37). A backup STAGES every
 * table's data into `${name}${SHEET_STAGING_SUFFIX}` (leaving the live canonical sheets untouched), and
 * only once ALL staging writes succeed does it commit a single atomic `batchUpdate` that deletes the old
 * canonical sheets and renames the staging tabs into their place. Space-free so it needs no A1 quoting.
 */
const SHEET_STAGING_SUFFIX = '__vroom_staging';

export interface SpreadsheetInfo {
  id: string;
  name: string;
  webViewLink: string;
  sheets: { id: number; title: string }[];
}

/**
 * Pre-built googleapis clients for {@link GoogleSheetsService}. Inject in-memory fakes in
 * tests to drive the real service logic (folder path walk, sheet clear+write, read
 * round-trip) with ZERO network. All three should share one backing store so folder
 * creation, file moves, and listing stay coherent across the Sheets + Drive surfaces.
 */
export interface GoogleSheetsClients {
  sheets: sheets_v4.Sheets;
  drive: drive_v3.Drive;
  driveService: GoogleDriveService;
}

export class GoogleSheetsService {
  private oauth2Client?: OAuth2Client;
  private sheets: sheets_v4.Sheets;
  private drive: drive_v3.Drive;
  private driveService: GoogleDriveService;

  /**
   * @param refreshToken  Google OAuth refresh token (ignored when `clients` is injected).
   * @param clients       Optional pre-built Sheets + Drive clients (see {@link GoogleSheetsClients}).
   *                      Production callers omit it and OAuth2-authed clients are built.
   */
  constructor(refreshToken: string, clients?: GoogleSheetsClients) {
    if (clients) {
      this.sheets = clients.sheets;
      this.drive = clients.drive;
      this.driveService = clients.driveService;
      return;
    }

    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    this.oauth2Client.setCredentials({
      refresh_token: refreshToken,
    });

    this.sheets = google.sheets({ version: 'v4', auth: this.oauth2Client });
    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
    this.driveService = new GoogleDriveService(refreshToken);
  }

  async createOrUpdateVroomSpreadsheet(
    userId: string,
    folderPath: string,
    displayName: string
  ): Promise<SpreadsheetInfo> {
    // Walk the folder path segments (e.g. "VROOM/Backups") to find-or-create each folder
    const targetFolderId = await this.resolveOrCreateFolderPath(folderPath);

    const spreadsheetName = `VROOM Data - ${displayName}`;
    const existingSpreadsheet = await this.findVroomSpreadsheet(targetFolderId, displayName);

    let spreadsheetId: string;
    if (existingSpreadsheet) {
      spreadsheetId = existingSpreadsheet.id;
    } else {
      const spreadsheet = await this.createSpreadsheet(spreadsheetName);
      if (!spreadsheet.spreadsheetId) {
        throw new SyncError(
          SyncErrorCode.NETWORK_ERROR,
          'Failed to create spreadsheet in Google Sheets'
        );
      }
      spreadsheetId = spreadsheet.spreadsheetId;

      await this.drive.files.update({
        fileId: spreadsheetId,
        addParents: targetFolderId,
        removeParents: 'root',
      });
    }

    await this.updateSpreadsheetWithUserData(spreadsheetId, userId);
    return this.getSpreadsheetInfo(spreadsheetId);
  }

  /**
   * Walk a slash-separated folder path (e.g. "VROOM/Backups"), finding or creating
   * each segment in the Drive hierarchy. Returns the leaf folder's ID.
   */
  private async resolveOrCreateFolderPath(folderPath: string): Promise<string> {
    const segments = folderPath
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);

    if (segments.length === 0) {
      throw new SyncError(SyncErrorCode.VALIDATION_ERROR, 'Backup folder path cannot be empty');
    }

    let parentId = '';
    for (const segment of segments) {
      const existing = await this.driveService.findFolder(segment, parentId || undefined);
      if (existing) {
        parentId = existing.id;
      } else {
        const created = await this.driveService.createFolder(segment, parentId || undefined);
        parentId = created.id;
      }
    }

    return parentId;
  }

  private async findVroomSpreadsheet(
    mainFolderId: string,
    userName: string
  ): Promise<{ id: string; name: string } | null> {
    const spreadsheetName = `VROOM Data - ${userName}`;
    const files = await this.driveService.listFilesInFolder(mainFolderId);
    const found = files.find(
      (file) =>
        file.name === spreadsheetName && file.mimeType === 'application/vnd.google-apps.spreadsheet'
    );
    return found ? { id: found.id, name: found.name } : null;
  }

  private async createSpreadsheet(title: string): Promise<sheets_v4.Schema$Spreadsheet> {
    const response = await this.sheets.spreadsheets.create({
      requestBody: {
        properties: { title },
        sheets: SHEET_NAMES.map((sheetTitle) => ({ properties: { title: sheetTitle } })),
      },
    });
    return response.data;
  }

  async getSpreadsheetInfo(spreadsheetId: string): Promise<SpreadsheetInfo> {
    const response = await this.sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'spreadsheetId,properties,sheets.properties',
    });

    const spreadsheet = response.data;
    if (!spreadsheet.spreadsheetId || !spreadsheet.properties?.title) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'Invalid spreadsheet data returned from Google Sheets'
      );
    }

    return {
      id: spreadsheet.spreadsheetId,
      name: spreadsheet.properties.title,
      webViewLink: `https://docs.google.com/spreadsheets/d/${spreadsheet.spreadsheetId}`,
      sheets:
        spreadsheet.sheets?.map((sheet: sheets_v4.Schema$Sheet) => ({
          id: sheet.properties?.sheetId || 0,
          title: sheet.properties?.title || 'Untitled',
        })) || [],
    };
  }

  private async ensureRequiredSheets(spreadsheetId: string): Promise<void> {
    const info = await this.getSpreadsheetInfo(spreadsheetId);
    const existingTitles = new Set(info.sheets.map((s) => s.title));
    const missing = SHEET_NAMES.filter((name) => !existingTitles.has(name));

    if (missing.length > 0) {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: missing.map((title) => ({
            addSheet: { properties: { title } },
          })),
        },
      });
    }
  }

  /**
   * Run a child query only when there are parent ids to query by, else return []. Collapses the
   * repeated `ids.length > 0 ? await db.select()…where(inArray(col, ids)) : []` guard (avoids a
   * pointless `inArray(col, [])` round-trip) into one named place. Behavior-identical to the
   * inline ternary it replaces.
   */
  private async queryIfNonEmpty<T>(
    ids: readonly unknown[],
    query: () => Promise<T[]>
  ): Promise<T[]> {
    return ids.length > 0 ? query() : [];
  }

  private async updateSpreadsheetWithUserData(
    spreadsheetId: string,
    userId: string
  ): Promise<void> {
    await this.ensureRequiredSheets(spreadsheetId);
    const db = getDb();

    const [userVehicles, userExpenses, userInsurance, userFinancing, userOdometer] =
      await Promise.all([
        db.select().from(vehicles).where(eq(vehicles.userId, userId)),
        db.select().from(expenses).where(eq(expenses.userId, userId)),
        db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, userId)),
        db
          .select()
          .from(vehicleFinancing)
          .innerJoin(vehicles, eq(vehicleFinancing.vehicleId, vehicles.id))
          .where(eq(vehicles.userId, userId)),
        db
          .select()
          .from(odometerEntries)
          .innerJoin(vehicles, eq(odometerEntries.vehicleId, vehicles.id))
          .where(eq(vehicles.userId, userId)),
      ]);

    // Query insurance terms for user's policies
    const policyIds = userInsurance.map((p) => p.id);
    const userInsuranceTerms = await this.queryIfNonEmpty(policyIds, () =>
      db.select().from(insuranceTerms).where(inArray(insuranceTerms.policyId, policyIds))
    );

    // Query junction rows for user's insurance terms
    const termIds = userInsuranceTerms.map((t) => t.id);
    const userInsuranceTermVehicles = await this.queryIfNonEmpty(termIds, () =>
      db.select().from(insuranceTermVehicles).where(inArray(insuranceTermVehicles.termId, termIds))
    );

    // Query insurance claims for user's policies
    const userInsuranceClaims = await this.queryIfNonEmpty(policyIds, () =>
      db.select().from(insuranceClaims).where(inArray(insuranceClaims.policyId, policyIds))
    );

    // Query photos directly by userId
    const userPhotos = await db.select().from(photos).where(eq(photos.userId, userId));

    // Query photo_refs for all user photos (batched to stay under SQLite variable limit)
    const photoIds = userPhotos.map((p) => p.id);
    const userPhotoRefs: (typeof photoRefs.$inferSelect)[] = [];
    const BATCH_SIZE = 500;
    for (let i = 0; i < photoIds.length; i += BATCH_SIZE) {
      const batch = photoIds.slice(i, i + BATCH_SIZE);
      const rows = await db.select().from(photoRefs).where(inArray(photoRefs.photoId, batch));
      userPhotoRefs.push(...rows);
    }

    // Query user preferences and sync state
    const userPreferencesRows = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    const syncStateRows = await db.select().from(syncState).where(eq(syncState.userId, userId));

    // Query reminders, reminder_vehicles, and reminder_notifications
    const userReminders = await db.select().from(reminders).where(eq(reminders.userId, userId));

    const reminderIds = userReminders.map((r) => r.id);
    const userReminderVehicles = await this.queryIfNonEmpty(reminderIds, () =>
      db.select().from(reminderVehicles).where(inArray(reminderVehicles.reminderId, reminderIds))
    );
    const userReminderNotifications = await db
      .select()
      .from(reminderNotifications)
      .where(eq(reminderNotifications.userId, userId));

    // Query trips directly by userId (userId-stamped, like photos)
    const userTrips = await db.select().from(trips).where(eq(trips.userId, userId));

    // Query the ACCEPTED shares this user GRANTED (vehicle-sharing T9, D7 + §6.4 blast-radius: ownerId
    // scope means an invitee never exports the owner's shares; accepted-only so restore re-creates exactly
    // what is exported).
    const userVehicleShares = await db
      .select()
      .from(vehicleShares)
      .where(and(eq(vehicleShares.ownerId, userId), eq(vehicleShares.status, 'accepted')));

    // Pair each canonical sheet title with the rows + headers it backs up. Order MUST match SHEET_NAMES:
    // the atomic swap sets each tab's `index` from this array's position, so it has to mirror the
    // spreadsheet's original create order or the backup's tabs would reshuffle every run.
    const tables: { title: string; rows: Record<string, unknown>[]; headers: readonly string[] }[] =
      [
        { title: 'Vehicles', rows: userVehicles, headers: SHEET_HEADERS.vehicles },
        { title: 'Expenses', rows: userExpenses, headers: SHEET_HEADERS.expenses },
        { title: 'Insurance Policies', rows: userInsurance, headers: SHEET_HEADERS.insurance },
        {
          title: 'Insurance Terms',
          rows: userInsuranceTerms,
          headers: SHEET_HEADERS.insuranceTerms,
        },
        {
          title: 'Insurance Term Vehicles',
          rows: userInsuranceTermVehicles,
          headers: SHEET_HEADERS.insuranceTermVehicles,
        },
        {
          title: 'Insurance Claims',
          rows: userInsuranceClaims,
          headers: SHEET_HEADERS.insuranceClaims,
        },
        {
          title: 'Vehicle Financing',
          rows: userFinancing.map((f) => f.vehicle_financing),
          headers: SHEET_HEADERS.financing,
        },
        {
          title: 'Odometer',
          rows: userOdometer.map((o) => o.odometer_entries),
          headers: SHEET_HEADERS.odometer,
        },
        { title: 'Photos', rows: userPhotos, headers: SHEET_HEADERS.photos },
        { title: 'Photo Refs', rows: userPhotoRefs, headers: SHEET_HEADERS.photoRefs },
        {
          title: 'User Preferences',
          rows: userPreferencesRows,
          headers: SHEET_HEADERS.userPreferences,
        },
        { title: 'Sync State', rows: syncStateRows, headers: SHEET_HEADERS.syncState },
        { title: 'Reminders', rows: userReminders, headers: SHEET_HEADERS.reminders },
        {
          title: 'Reminder Vehicles',
          rows: userReminderVehicles,
          headers: SHEET_HEADERS.reminderVehicles,
        },
        {
          title: 'Reminder Notifications',
          rows: userReminderNotifications,
          headers: SHEET_HEADERS.reminderNotifications,
        },
        { title: 'Trips', rows: userTrips, headers: SHEET_HEADERS.trips },
        { title: 'Vehicle Shares', rows: userVehicleShares, headers: SHEET_HEADERS.vehicleShares },
      ];

    await this.writeAllSheetsAtomically(spreadsheetId, tables);
  }

  /**
   * Write every table's data to the backup spreadsheet ATOMICALLY (#37). The previous design cleared
   * then re-wrote each LIVE sheet in place, so a failure mid-run (network blip, 429, the process dying)
   * left a TORN backup — some sheets rewritten, the one that was mid-write emptied by its preceding clear,
   * the rest stale — on what may be the user's ONLY copy (NORTH_STAR #1 data-loss). This instead:
   *   1. STAGE — write each table into a fresh `${title}${SHEET_STAGING_SUFFIX}` tab. The live canonical
   *      sheets are never touched in this phase, so any failure here is harmless: the prior backup is
   *      fully intact. We clean up the partial staging tabs and rethrow.
   *   2. COMMIT — once ALL staging writes succeed, ONE `batchUpdate` deletes the old canonical sheets and
   *      renames each staging tab to its canonical title. Sheets applies a batchUpdate all-or-nothing, so
   *      a concurrent reader sees either the entire old backup or the entire new one, never a mix.
   * Net effect: the backup is replaced as a single transaction, and the old copy is destroyed only at the
   * instant the new one takes its place.
   */
  private async writeAllSheetsAtomically(
    spreadsheetId: string,
    tables: { title: string; rows: Record<string, unknown>[]; headers: readonly string[] }[]
  ): Promise<void> {
    const stagingTitles = tables.map((t) => `${t.title}${SHEET_STAGING_SUFFIX}`);
    // Drop any staging tabs orphaned by a previously-interrupted backup, so the create below is clean.
    await this.deleteSheetsByTitle(spreadsheetId, stagingTitles);

    try {
      // Phase 1 — create the staging tabs, then fill them. All writes target staging only.
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: stagingTitles.map((title) => ({ addSheet: { properties: { title } } })),
        },
      });
      await Promise.all(
        tables.map((t) =>
          this.writeSheetValues(
            spreadsheetId,
            `${t.title}${SHEET_STAGING_SUFFIX}`,
            t.rows,
            t.headers
          )
        )
      );
    } catch (err) {
      // Staging failed → the live backup is untouched. Best-effort cleanup of partial staging tabs.
      await this.deleteSheetsByTitle(spreadsheetId, stagingTitles).catch(() => {});
      throw err;
    }

    // Phase 2 — atomic swap: delete the old canonical sheets, rename staging → canonical, in ONE batch.
    // Each rename also sets `index` to the table's canonical position so tab ORDER is preserved across
    // backups (a staging tab is born at the end; without this the order would drift every run, which is
    // user-visible in the spreadsheet — and pinned by the create-tab-order test).
    const info = await this.getSpreadsheetInfo(spreadsheetId);
    const idByTitle = new Map(info.sheets.map((s) => [s.title, s.id]));
    const requests: sheets_v4.Schema$Request[] = [];
    for (const t of tables) {
      const oldId = idByTitle.get(t.title);
      if (oldId !== undefined) {
        requests.push({ deleteSheet: { sheetId: oldId } });
      }
    }
    tables.forEach((t, index) => {
      const stagingId = idByTitle.get(`${t.title}${SHEET_STAGING_SUFFIX}`);
      if (stagingId !== undefined) {
        requests.push({
          updateSheetProperties: {
            properties: { sheetId: stagingId, title: t.title, index },
            fields: 'title,index',
          },
        });
      }
    });
    await this.sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  }

  /** Delete every sheet whose title is in `titles` (best-effort by current title→id lookup). */
  private async deleteSheetsByTitle(spreadsheetId: string, titles: string[]): Promise<void> {
    const info = await this.getSpreadsheetInfo(spreadsheetId);
    const wanted = new Set(titles);
    const requests = info.sheets
      .filter((s) => wanted.has(s.title))
      .map((s) => ({ deleteSheet: { sheetId: s.id } }));
    if (requests.length > 0) {
      await this.sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
    }
  }

  /** Write a header row + the data rows into one sheet (RAW). Assumes the sheet exists and is empty. */
  private async writeSheetValues<T extends Record<string, unknown>>(
    spreadsheetId: string,
    sheetName: string,
    data: T[],
    headers: readonly string[]
  ): Promise<void> {
    const values = [
      [...headers],
      ...data.map((row) => headers.map((header) => this.formatValue(row[header]))),
    ];

    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:${String.fromCharCode(64 + headers.length)}${data.length + 1}`,
      // RAW (not USER_ENTERED) so every cell is stored VERBATIM as text (#36). USER_ENTERED makes
      // Sheets PARSE each cell as if typed: a value beginning with `=`/`+`/`-`/`@` becomes a live
      // formula (formula injection + the cell silently round-trips back as the formula RESULT, not the
      // user's data — backup corruption of the user's OWN records, NORTH_STAR #1), and it reformats
      // numbers/dates. RAW stores the literal string, so the backup→restore round-trip is byte-exact and
      // injection-inert with NO escaping needed — do NOT add a `'`-prefix escape here (that scheme is for
      // one-way CSV export; on this round-trip path it reintroduces the C399/C401 apostrophe corruption,
      // see csv-safety.ts header). parseValue still does the type coercion symmetrically on read.
      valueInputOption: 'RAW',
      requestBody: { values },
    });
  }

  private formatValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  async readSheetData(
    spreadsheetId: string,
    range: string
  ): Promise<(string | number | boolean)[][]> {
    const response = await this.sheets.spreadsheets.values.get({ spreadsheetId, range });
    return response.data.values || [];
  }

  async readSpreadsheetData(spreadsheetId: string): Promise<{
    metadata: { version: string; timestamp: string; userId: string };
    vehicles: Record<string, unknown>[];
    expenses: Record<string, unknown>[];
    financing: Record<string, unknown>[];
    insurance: Record<string, unknown>[];
    insuranceTerms: Record<string, unknown>[];
    insuranceTermVehicles: Record<string, unknown>[];
    insuranceClaims: Record<string, unknown>[];
    photos: Record<string, unknown>[];
    odometer: Record<string, unknown>[];
    photoRefs: Record<string, unknown>[];
    userPreferences: Record<string, unknown>[];
    syncState: Record<string, unknown>[];
    reminders: Record<string, unknown>[];
    reminderVehicles: Record<string, unknown>[];
    reminderNotifications: Record<string, unknown>[];
    trips: Record<string, unknown>[];
    vehicleShares: Record<string, unknown>[];
  }> {
    const [
      vehiclesData,
      expensesData,
      insuranceData,
      insuranceTermsData,
      insuranceTermVehiclesData,
      insuranceClaimsData,
      financingData,
      photosData,
      odometerData,
      photoRefsData,
      userPreferencesData,
      syncStateData,
      remindersData,
      reminderVehiclesData,
      reminderNotificationsData,
      tripsData,
      vehicleSharesData,
    ] = await Promise.all([
      this.readSheetData(spreadsheetId, 'Vehicles!A:Z'),
      this.readSheetData(spreadsheetId, 'Expenses!A:Z'),
      this.readSheetData(spreadsheetId, 'Insurance Policies!A:Z'),
      this.readSheetData(spreadsheetId, 'Insurance Terms!A:Z').catch(() => []),
      this.readSheetData(spreadsheetId, 'Insurance Term Vehicles!A:Z').catch(() => []),
      this.readSheetData(spreadsheetId, 'Insurance Claims!A:Z').catch(() => []),
      this.readSheetData(spreadsheetId, 'Vehicle Financing!A:Z'),
      this.readSheetData(spreadsheetId, 'Photos!A:Z').catch(() => []),
      this.readSheetData(spreadsheetId, 'Odometer!A:Z').catch(() => []),
      this.readSheetData(spreadsheetId, 'Photo Refs!A:Z').catch(() => []),
      this.readSheetData(spreadsheetId, 'User Preferences!A:Z').catch(() => []),
      this.readSheetData(spreadsheetId, 'Sync State!A:Z').catch(() => []),
      this.readSheetData(spreadsheetId, 'Reminders!A:Z').catch(() => []),
      this.readSheetData(spreadsheetId, 'Reminder Vehicles!A:Z').catch(() => []),
      this.readSheetData(spreadsheetId, 'Reminder Notifications!A:Z').catch(() => []),
      // Trips tab absent in pre-trips-location backups → tolerate a missing tab (OPTIONAL_BACKUP_FILES).
      this.readSheetData(spreadsheetId, 'Trips!A:Z').catch(() => []),
      // Vehicle Shares tab absent in pre-sharing backups → tolerate a missing tab (OPTIONAL_BACKUP_FILES).
      this.readSheetData(spreadsheetId, 'Vehicle Shares!A:Z').catch(() => []),
    ]);

    const vehicleRecords = this.parseSheetData(vehiclesData);
    const expenseRecords = this.parseSheetData(expensesData);
    const insurance = this.parseSheetData(insuranceData);
    const insuranceTermsRecords = this.parseSheetData(insuranceTermsData);
    const insuranceTermVehiclesRecords = this.parseSheetData(insuranceTermVehiclesData);
    const insuranceClaimsRecords = this.parseSheetData(insuranceClaimsData);
    const financing = this.parseSheetData(financingData);
    const photoRecords = this.parseSheetData(photosData);
    const odometer = this.parseSheetData(odometerData);
    const photoRefs = this.parseSheetData(photoRefsData);
    const userPreferencesRecords = this.parseSheetData(userPreferencesData);
    const syncStateRecords = this.parseSheetData(syncStateData);
    const remindersRecords = this.parseSheetData(remindersData);
    const reminderVehiclesRecords = this.parseSheetData(reminderVehiclesData);
    const reminderNotificationsRecords = this.parseSheetData(reminderNotificationsData);
    const tripsRecords = this.parseSheetData(tripsData);
    const vehicleSharesRecords = this.parseSheetData(vehicleSharesData);

    const userId = vehicleRecords.length > 0 ? (vehicleRecords[0].userId as string) : '';

    return {
      metadata: { version: '1.0.0', timestamp: new Date().toISOString(), userId },
      vehicles: vehicleRecords,
      expenses: expenseRecords,
      financing,
      insurance,
      insuranceTerms: insuranceTermsRecords,
      insuranceTermVehicles: insuranceTermVehiclesRecords,
      insuranceClaims: insuranceClaimsRecords,
      photos: photoRecords,
      odometer,
      photoRefs,
      userPreferences: userPreferencesRecords,
      syncState: syncStateRecords,
      reminders: remindersRecords,
      reminderVehicles: reminderVehiclesRecords,
      reminderNotifications: reminderNotificationsRecords,
      trips: tripsRecords,
      vehicleShares: vehicleSharesRecords,
    };
  }

  private parseSheetData(sheetData: (string | number | boolean)[][]): Record<string, unknown>[] {
    if (sheetData.length === 0) return [];

    const headers = sheetData[0] as string[];
    const rows = sheetData.slice(1);

    return rows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < headers.length; i++) {
        obj[headers[i]] = this.parseValue(row[i]);
      }
      return obj;
    });
  }

  private parseValue(value: string | number | boolean | undefined): unknown {
    if (value === '' || value === null || value === undefined) return null;
    if (value === 'true' || value === 'false') return value === 'true';
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      if (!Number.isNaN(Number(value)) && value.trim() !== '') return Number(value);
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return new Date(value);
    }
    return value;
  }
}

/**
 * Create a GoogleSheetsService for a specific provider.
 * Queries DB by providerId + userId (ownership check), decrypts credentials.
 * Used by the restore path only — backup strategy instantiates directly.
 */
export async function createSheetsServiceForProvider(
  providerId: string,
  userId: string
): Promise<GoogleSheetsService> {
  const { userProviders } = await import('../../../db/schema');
  const { decrypt } = await import('../../../utils/encryption');
  const { NotFoundError, ValidationError } = await import('../../../errors');

  const db = getDb();
  const providerRow = await db
    .select()
    .from(userProviders)
    .where(
      and(
        eq(userProviders.id, providerId),
        eq(userProviders.userId, userId),
        eq(userProviders.domain, 'storage'),
        eq(userProviders.status, 'active')
      )
    )
    .limit(1);

  if (!providerRow.length) {
    throw new NotFoundError('Provider');
  }

  let credentials: { refreshToken?: string };
  try {
    credentials = JSON.parse(decrypt(providerRow[0].credentials)) as { refreshToken?: string };
  } catch {
    throw new ValidationError('Failed to decrypt provider credentials');
  }

  if (!credentials.refreshToken) {
    throw new ValidationError(
      'Provider has no refresh token. Please re-connect your Google account.'
    );
  }

  return new GoogleSheetsService(credentials.refreshToken);
}
