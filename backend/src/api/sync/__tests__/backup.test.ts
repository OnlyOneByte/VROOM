/**
 * Backup Service Tests — coerceRow, validation, and round-trip integrity
 *
 * These tests verify that CSV/Sheets data is correctly coerced into JS types
 * that pass Zod validation from Drizzle insert schemas. They catch regressions
 * like NOT NULL boolean columns receiving null from empty CSV cells.
 */

import { describe, expect, test } from 'bun:test';
import { getTableColumns } from 'drizzle-orm';
import { createInsertSchema } from 'drizzle-zod';
import fc from 'fast-check';
import { CONFIG, TABLE_SCHEMA_MAP } from '../../../config';
import {
  expenses,
  insuranceClaims,
  insurancePolicies,
  odometerEntries,
  photoRefs,
  photos,
  reminderNotifications,
  trips,
  userPreferences,
  vehicleFinancing,
  vehicles,
} from '../../../db/schema';
import type { ParsedBackupData } from '../../../types';
import { backupService, coerceRow } from '../backup';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default string values by SQLite column type (mimics CSV output). */
const COLUMN_TYPE_DEFAULTS: Record<string, string> = {
  SQLiteBoolean: 'false',
  SQLiteTimestamp: '2025-01-15T00:00:00.000Z',
  SQLiteInteger: '100',
  SQLiteReal: '50.00',
  SQLiteTextJson: '[]',
};

/** Build a minimal valid CSV-like row (all string values) for a given table. */
function buildMinimalStringRow(
  table: Parameters<typeof getTableColumns>[0],
  overrides: Record<string, string> = {}
): Record<string, string> {
  const columns = getTableColumns(table);
  const row: Record<string, string> = {};

  for (const [name, col] of Object.entries(columns)) {
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle column type not fully exposed
    const c = col as any;
    if (overrides[name] !== undefined) {
      row[name] = overrides[name];
    } else if (COLUMN_TYPE_DEFAULTS[c.columnType]) {
      row[name] = COLUMN_TYPE_DEFAULTS[c.columnType];
    } else if (c.enumValues && c.enumValues.length > 0) {
      row[name] = c.enumValues[0];
    } else {
      row[name] = `test-${name}`;
    }
  }
  return row;
}

// ---------------------------------------------------------------------------
// coerceRow: Boolean column handling
// ---------------------------------------------------------------------------

describe('coerceRow: Boolean columns', () => {
  test('empty string on NOT NULL boolean defaults to false', () => {
    const row = buildMinimalStringRow(expenses, { missedFillup: '' });
    const result = coerceRow(row, expenses);
    expect(result.missedFillup).toBe(false);
  });

  test('null on NOT NULL boolean defaults to false', () => {
    const row = buildMinimalStringRow(expenses, {});
    row.missedFillup = null as unknown as string;
    const result = coerceRow(row, expenses);
    expect(result.missedFillup).toBe(false);
  });

  test('undefined on NOT NULL boolean defaults to false', () => {
    const row = buildMinimalStringRow(expenses, {});
    delete (row as Record<string, unknown>).missedFillup;
    const result = coerceRow(row, expenses);
    expect(result.missedFillup).toBe(false);
  });

  test('"null" string on NOT NULL boolean defaults to false', () => {
    const row = buildMinimalStringRow(expenses, {
      missedFillup: 'null',
    });
    const result = coerceRow(row, expenses);
    expect(result.missedFillup).toBe(false);
  });

  test('"true" string coerces to true', () => {
    const row = buildMinimalStringRow(expenses, {
      missedFillup: 'true',
    });
    const result = coerceRow(row, expenses);
    expect(result.missedFillup).toBe(true);
  });

  test('"1" string coerces to true', () => {
    const row = buildMinimalStringRow(expenses, { missedFillup: '1' });
    const result = coerceRow(row, expenses);
    expect(result.missedFillup).toBe(true);
  });

  test('"false" string coerces to false', () => {
    const row = buildMinimalStringRow(expenses, {
      missedFillup: 'false',
    });
    const result = coerceRow(row, expenses);
    expect(result.missedFillup).toBe(false);
  });

  test('boolean handling works on vehicleFinancing.isActive', () => {
    const row = buildMinimalStringRow(vehicleFinancing, { isActive: '' });
    const result = coerceRow(row, vehicleFinancing);
    expect(result.isActive).toBe(false);
  });

  test('boolean handling works on insurancePolicies.isActive', () => {
    const row = buildMinimalStringRow(insurancePolicies, { isActive: '' });
    const result = coerceRow(row, insurancePolicies);
    expect(result.isActive).toBe(false);
  });

  test('boolean handling works on photos.isCover', () => {
    const row = buildMinimalStringRow(photos, { isCover: '' });
    const result = coerceRow(row, photos);
    expect(result.isCover).toBe(false);
  });

  test('photos.isCover "true" coerces to true', () => {
    const row = buildMinimalStringRow(photos, { isCover: 'true' });
    const result = coerceRow(row, photos);
    expect(result.isCover).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// coerceRow: Timestamp columns
// ---------------------------------------------------------------------------

describe('coerceRow: Timestamp columns', () => {
  test('valid ISO string coerces to Date', () => {
    const row = buildMinimalStringRow(expenses, { date: '2025-06-15T10:30:00.000Z' });
    const result = coerceRow(row, expenses);
    expect(result.date).toBeInstanceOf(Date);
    expect((result.date as Date).toISOString()).toBe('2025-06-15T10:30:00.000Z');
  });

  test('empty timestamp coerces to null', () => {
    const row = buildMinimalStringRow(expenses, { createdAt: '' });
    const result = coerceRow(row, expenses);
    expect(result.createdAt).toBeNull();
  });

  test('invalid date string coerces to null', () => {
    const row = buildMinimalStringRow(expenses, { date: 'not-a-date' });
    const result = coerceRow(row, expenses);
    expect(result.date).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// coerceRow: JSON columns
// ---------------------------------------------------------------------------

describe('coerceRow: JSON columns', () => {
  test('tags JSON array on expenses is parsed', () => {
    const row = buildMinimalStringRow(expenses, { tags: '["oil-change","filter"]' });
    const result = coerceRow(row, expenses);
    expect(result.tags).toEqual(['oil-change', 'filter']);
  });

  test('empty JSON column coerces to null', () => {
    const row = buildMinimalStringRow(expenses, { tags: '' });
    const result = coerceRow(row, expenses);
    expect(result.tags).toBeNull();
  });

  test('invalid JSON coerces to null', () => {
    const row = buildMinimalStringRow(expenses, { tags: '{broken' });
    const result = coerceRow(row, expenses);
    expect(result.tags).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// coerceRow: Numeric columns
// ---------------------------------------------------------------------------

describe('coerceRow: Numeric columns', () => {
  test('integer string coerces to number', () => {
    const row = buildMinimalStringRow(expenses, { mileage: '45000' });
    const result = coerceRow(row, expenses);
    expect(result.mileage).toBe(45000);
  });

  test('real string coerces to float', () => {
    // volume (gal/kWh) is the REAL-affinity numeric column. expenseAmount is now an INTEGER cents column
    // (money-cents-migration), so a decimal string there ROUNDS (covered separately below) — volume is the
    // column that still exercises the float-preserving REAL coerce branch.
    const row = buildMinimalStringRow(expenses, { volume: '123.45' });
    const result = coerceRow(row, expenses);
    expect(result.volume).toBe(123.45);
  });

  test('money INTEGER column rounds a decimal string (cents are whole — money-cents-migration)', () => {
    // expenseAmount is integer CENTS post-0009; a 2.0.0 backup stores whole-cent integers. A stray decimal
    // (e.g. a hand-edited CSV) rounds to the nearest whole cent, never truncates.
    const row = buildMinimalStringRow(expenses, { expenseAmount: '1234.56' });
    const result = coerceRow(row, expenses);
    expect(result.expenseAmount).toBe(1235);
  });

  test('empty numeric coerces to null', () => {
    const row = buildMinimalStringRow(expenses, { mileage: '' });
    const result = coerceRow(row, expenses);
    expect(result.mileage).toBeNull();
  });

  test('non-numeric string coerces to null', () => {
    const row = buildMinimalStringRow(expenses, { mileage: 'abc' });
    const result = coerceRow(row, expenses);
    expect(result.mileage).toBeNull();
  });

  // #68 (data-safety, C209): the Google Sheets restore reads cells as FORMATTED_VALUE (default
  // valueRenderOption), so a thousands-separated odometer/mileage comes back as a string like
  // "12,345". The old Number.parseInt(strVal, 10) stopped at the comma → 12 (a 1000x silent
  // corruption, NORTH_STAR #1). These pin the comma-aware strict parse.
  test('#68 INTEGER: a thousands-separated mileage keeps its full value (not parseInt-truncated)', () => {
    const row = buildMinimalStringRow(expenses, { mileage: '12,345' });
    const result = coerceRow(row, expenses);
    expect(result.mileage).toBe(12345); // was 12 under parseInt — the bug
  });

  test('#68 INTEGER: a "12345.0"-style Sheets numeric string rounds to the whole number', () => {
    const row = buildMinimalStringRow(expenses, { mileage: '45000.0' });
    const result = coerceRow(row, expenses);
    expect(result.mileage).toBe(45000);
  });

  test('#68 INTEGER: a genuine garbage tail still rejects to null (strict, not truncated)', () => {
    // Number('12abc') is NaN (unlike parseInt('12abc')=12) → null, matching the garbage→null contract.
    const row = buildMinimalStringRow(expenses, { mileage: '12abc' });
    const result = coerceRow(row, expenses);
    expect(result.mileage).toBeNull();
  });

  test('#68 REAL: a thousands-separated amount keeps its full value (not parseFloat-truncated)', () => {
    // volume is the REAL-affinity column (expenseAmount is now integer cents); the comma-aware strict
    // parse it guards still applies to every REAL column the Sheets restore reads as FORMATTED_VALUE.
    const row = buildMinimalStringRow(expenses, { volume: '1,234.56' });
    const result = coerceRow(row, expenses);
    expect(result.volume).toBe(1234.56); // was 1 under parseFloat — the bug
  });

  test('#68 REAL: a plain integer-valued amount (CSV round-trip) is unchanged', () => {
    // The CSV path writes a raw number with no separators — confirm the fix didn't regress it.
    const row = buildMinimalStringRow(expenses, { volume: '50' });
    const result = coerceRow(row, expenses);
    expect(result.volume).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Validation: coerced rows pass Zod insert schemas
// ---------------------------------------------------------------------------

describe('Validation: coerced rows pass insert schemas', () => {
  for (const [key, table] of Object.entries(TABLE_SCHEMA_MAP)) {
    test(`coerced ${key} row passes createInsertSchema validation`, () => {
      const row = buildMinimalStringRow(table);
      const coerced = coerceRow(row, table);
      const schema = createInsertSchema(table);
      const result = schema.safeParse(coerced);
      if (!result.success) {
        const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
        throw new Error(`${key} validation failed:\n${issues.join('\n')}`);
      }
      expect(result.success).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Validation: empty boolean fields still pass validation
// ---------------------------------------------------------------------------

describe('Validation: empty NOT NULL booleans pass after coercion', () => {
  test('expense with empty missedFillup passes validation', () => {
    const row = buildMinimalStringRow(expenses, { missedFillup: '' });
    const coerced = coerceRow(row, expenses);
    const schema = createInsertSchema(expenses);
    const result = schema.safeParse(coerced);
    expect(result.success).toBe(true);
  });

  test('vehicleFinancing with empty isActive passes validation', () => {
    const row = buildMinimalStringRow(vehicleFinancing, { isActive: '' });
    const coerced = coerceRow(row, vehicleFinancing);
    const schema = createInsertSchema(vehicleFinancing);
    const result = schema.safeParse(coerced);
    expect(result.success).toBe(true);
  });

  test('insurancePolicies with empty isActive passes validation', () => {
    const row = buildMinimalStringRow(insurancePolicies, { isActive: '' });
    const coerced = coerceRow(row, insurancePolicies);
    const schema = createInsertSchema(insurancePolicies);
    const result = schema.safeParse(coerced);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// coerceRow: NOT NULL columns with a STATIC default (C175 deep-review).
//
// An empty/null backup cell for a NOT NULL column carrying a static default must coerce to that DEFAULT,
// never to null — else the insert throws `NOT NULL constraint failed` and the WHOLE restore aborts (the
// user can't recover ANY data from their own valid backup, NORTH_STAR #1). Verified firsthand that the
// pre-fix coerceRow nulled these (the theming-engine C174 `themePreference` add re-surfaced the
// DatabaseMigrations.md footgun; `currencyUnit`/`backupFrequency`/`unitPreferences`/`syncInactivityMinutes`
// shared the latent gap). This is the non-boolean sibling of the block above.
// ---------------------------------------------------------------------------

describe('coerceRow: empty NOT NULL columns with a static default fall back to the default (C175)', () => {
  // Drive the REAL schema column metadata so this can't drift from the table definition.
  const cols = getTableColumns(userPreferences) as Record<string, { default?: unknown }>;

  test.each([
    ['themePreference', 'theme'],
    ['currencyUnit', 'currency'],
    ['backupFrequency', 'frequency'],
  ] as const)('empty %s coerces to its column default (not null) — restore cannot abort', (colName) => {
    const expected = cols[colName].default;
    // Sanity: the column genuinely declares a static default (guards against a schema change that drops it).
    expect(expected, `${colName} must declare a static default`).toBeDefined();
    for (const empty of ['', 'null', 'NULL', 'undefined']) {
      const coerced = coerceRow({ userId: 'u1', [colName]: empty }, userPreferences);
      expect(coerced[colName], `${colName}='${empty}' must fall back to the default`).toBe(
        expected
      );
    }
    // An entirely ABSENT key (an old backup predating the column) is also safe — left absent so the DB
    // default applies (it must NOT be forced to null).
    const absent = coerceRow({ userId: 'u1' }, userPreferences);
    expect(absent[colName] === undefined || absent[colName] === expected).toBe(true);
  });

  test('a full userPreferences row of empties coerces to a schema-valid row (whole-row restore survives)', () => {
    // Every NOT NULL column blank — the worst-case partial/legacy backup. Pre-fix this produced multiple
    // nulls → NOT NULL violations on insert. Now the insert schema accepts the coerced row.
    const row = buildMinimalStringRow(userPreferences, {
      themePreference: '',
      currencyUnit: '',
      backupFrequency: '',
      unitPreferences: '',
      syncInactivityMinutes: '',
    });
    const coerced = coerceRow(row, userPreferences);
    expect(coerced.themePreference).toBe('default');
    const schema = createInsertSchema(userPreferences);
    expect(schema.safeParse(coerced).success).toBe(true);
  });

  test('a real (non-empty) value is preserved — the fallback is not over-broad', () => {
    const coerced = coerceRow({ userId: 'u1', themePreference: 'instrument' }, userPreferences);
    expect(coerced.themePreference).toBe('instrument');
  });
});

// ---------------------------------------------------------------------------
// validateBackupData: well-formed backup passes
// ---------------------------------------------------------------------------

describe('validateBackupData: acceptance', () => {
  test('valid parsed backup passes validation', () => {
    const backup: ParsedBackupData = {
      metadata: {
        version: CONFIG.backup.currentVersion,
        timestamp: new Date().toISOString(),
        userId: 'u1',
      },
      vehicles: [coerceRow(buildMinimalStringRow(vehicles, { userId: 'u1' }), vehicles)],
      expenses: [
        coerceRow(
          buildMinimalStringRow(expenses, {
            vehicleId: 'test-id',
            userId: 'u1',
            missedFillup: '',
          }),
          expenses
        ),
      ],
      financing: [],
      insurance: [],
      insuranceTerms: [],
      insuranceTermVehicles: [],
      userPreferences: [],
      syncState: [],
      photos: [],
      odometer: [],
      photoRefs: [],
    };
    // Fix vehicleId reference
    (backup.expenses[0] as Record<string, unknown>).vehicleId = backup.vehicles[0].id;

    const result = backupService.validateBackupData(backup);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('valid backup with photos passes validation', () => {
    const vehicle = coerceRow(buildMinimalStringRow(vehicles, { userId: 'u1' }), vehicles);
    const photo = coerceRow(
      buildMinimalStringRow(photos, {
        entityType: 'vehicle',
        entityId: vehicle.id as string,
        isCover: 'true',
      }),
      photos
    );
    const backup: ParsedBackupData = {
      metadata: {
        version: CONFIG.backup.currentVersion,
        timestamp: new Date().toISOString(),
        userId: 'u1',
      },
      vehicles: [vehicle],
      expenses: [],
      financing: [],
      insurance: [],
      insuranceTerms: [],
      insuranceTermVehicles: [],
      userPreferences: [],
      syncState: [],
      photos: [photo],
      odometer: [],
      photoRefs: [],
    };

    const result = backupService.validateBackupData(backup);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validateBackupData: cross-row UNIQUE constraints (#127, C428)
// A corrupt/truncated backup whose rows violate a DB unique index (duplicate non-null clientId /
// licensePlate) passes per-row schema + referential checks but throws on the 2nd colliding INSERT.
// Because bun-sqlite's async-tx callback does NOT roll back the wipe (the C151 footgun), a replace-mode
// restore would leave the account EMPTY. Catching the duplicate at validation = the insert can't fail on
// it = the destructive wipe never runs. (The general transient-failure atomicity fix is escalated C428.)
// ---------------------------------------------------------------------------
describe('validateBackupData: cross-row unique constraints (#127)', () => {
  function backupWith(over: Partial<ParsedBackupData>): ParsedBackupData {
    return {
      metadata: {
        version: CONFIG.backup.currentVersion,
        timestamp: new Date().toISOString(),
        userId: 'u1',
      },
      vehicles: [],
      expenses: [],
      financing: [],
      insurance: [],
      insuranceTerms: [],
      insuranceTermVehicles: [],
      userPreferences: [],
      syncState: [],
      photos: [],
      odometer: [],
      photoRefs: [],
      ...over,
    };
  }

  test('two expenses sharing a non-null clientId are rejected (would crash the restore insert)', () => {
    const v = coerceRow(buildMinimalStringRow(vehicles, { userId: 'u1' }), vehicles);
    const mkExpense = () =>
      coerceRow(
        buildMinimalStringRow(expenses, {
          vehicleId: v.id as string,
          userId: 'u1',
          missedFillup: '',
        }),
        expenses
      );
    const e1 = { ...mkExpense(), id: 'e1', clientId: 'dup-cid' } as Record<string, unknown>;
    const e2 = { ...mkExpense(), id: 'e2', clientId: 'dup-cid' } as Record<string, unknown>;
    const result = backupService.validateBackupData(
      backupWith({ vehicles: [v], expenses: [e1, e2] })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('clientId'))).toBe(true);
  });

  test('two vehicles sharing a non-null licensePlate are rejected', () => {
    const v1 = {
      ...coerceRow(buildMinimalStringRow(vehicles, { userId: 'u1' }), vehicles),
      id: 'v1',
      licensePlate: 'ABC123',
    } as Record<string, unknown>;
    const v2 = {
      ...coerceRow(buildMinimalStringRow(vehicles, { userId: 'u1' }), vehicles),
      id: 'v2',
      licensePlate: 'ABC123',
    } as Record<string, unknown>;
    const result = backupService.validateBackupData(backupWith({ vehicles: [v1, v2] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('licensePlate'))).toBe(true);
  });

  test('NULL licensePlate does NOT collide (the index is partial — many nulls allowed)', () => {
    // Explicitly NULL the plate on both: the partial unique index is `WHERE license_plate IS NOT NULL`,
    // so two null-plate vehicles are NOT a duplicate — dupCheck must skip nulls. (buildMinimalStringRow
    // fills every column with a `test-<name>` default, so without this override BOTH would share
    // 'test-licensePlate' and legitimately collide — confirming the dupCheck fires; this pins the null skip.)
    const v1 = {
      ...coerceRow(buildMinimalStringRow(vehicles, { userId: 'u1' }), vehicles),
      id: 'v1',
      licensePlate: null,
    } as Record<string, unknown>;
    const v2 = {
      ...coerceRow(buildMinimalStringRow(vehicles, { userId: 'u1' }), vehicles),
      id: 'v2',
      licensePlate: null,
    } as Record<string, unknown>;
    const result = backupService.validateBackupData(backupWith({ vehicles: [v1, v2] }));
    expect(result.valid).toBe(true);
  });

  // The three COMPOSITE unique indexes the original #127 check missed (C291). Each is a real
  // CREATE UNIQUE INDEX in the migrations on a backed-up + restored table, so a duplicate survives
  // per-row + referential validation, then throws on the colliding INSERT AFTER the replace-mode
  // wipe → empty account (the same #127/C428 / C151-footgun data-loss trigger as clientId/licensePlate).
  // Each asserts on the SPECIFIC unique-constraint message substring, so a parallel referential error
  // (the synthetic parent rows aren't all present) cannot make the assertion pass spuriously — the
  // assertion fires only if THIS unique check produced its error.
  test('two photoRefs sharing (photoId, providerId) are rejected — pr_photo_provider_idx', () => {
    const mk = (id: string) =>
      ({
        ...coerceRow(buildMinimalStringRow(photoRefs), photoRefs),
        id,
        photoId: 'photo-1',
        providerId: 'provider-1',
      }) as Record<string, unknown>;
    const result = backupService.validateBackupData(
      backupWith({ photoRefs: [mk('pr1'), mk('pr2')] })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('photoRef photo+provider'))).toBe(true);
  });

  test('two reminderNotifications sharing (reminderId, dueDate) are rejected — rn_reminder_due_idx', () => {
    const due = new Date('2024-03-01T00:00:00Z');
    const mk = (id: string) =>
      ({
        ...coerceRow(
          buildMinimalStringRow(reminderNotifications, { userId: 'u1' }),
          reminderNotifications
        ),
        id,
        reminderId: 'rem-1',
        dueDate: due,
        dueOdometer: null,
      }) as Record<string, unknown>;
    const result = backupService.validateBackupData(
      backupWith({ reminderNotifications: [mk('rn1'), mk('rn2')] })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('reminder+dueDate'))).toBe(true);
  });

  test('two MILEAGE reminderNotifications sharing (reminderId, dueOdometer) are rejected — rn_reminder_odo_idx', () => {
    // Mileage rows carry a NULL dueDate (the time index treats them as distinct) but collide on the
    // partial odometer index. The composite check on (reminderId, dueOdometer) must catch them.
    const mk = (id: string) =>
      ({
        ...coerceRow(
          buildMinimalStringRow(reminderNotifications, { userId: 'u1' }),
          reminderNotifications
        ),
        id,
        reminderId: 'rem-1',
        dueDate: null,
        dueOdometer: 50000,
      }) as Record<string, unknown>;
    const result = backupService.validateBackupData(
      backupWith({ reminderNotifications: [mk('rn1'), mk('rn2')] })
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('reminder+dueOdometer'))).toBe(true);
  });

  test('mileage reminderNotifications at DIFFERENT odometers do NOT trip the unique check (NULL dueDate + distinct dueOdometer)', () => {
    // Two mileage rows for the same reminder but DIFFERENT odometer milestones: NULL dueDate makes the
    // time index distinct, and distinct dueOdometer makes the mileage index distinct too → neither
    // composite check should flag them. Pins that the null-skip + distinct-key path mirrors SQLite
    // semantics (a regression that keyed nulls as '' would falsely flag the time index here). Asserts
    // specifically that NO unique-constraint error was produced (a parallel referential error from the
    // synthetic parent-less reminder is irrelevant to what this test pins).
    const mk = (id: string, odo: number) =>
      ({
        ...coerceRow(
          buildMinimalStringRow(reminderNotifications, { userId: 'u1' }),
          reminderNotifications
        ),
        id,
        reminderId: 'rem-1',
        dueDate: null,
        dueOdometer: odo,
      }) as Record<string, unknown>;
    const result = backupService.validateBackupData(
      backupWith({ reminderNotifications: [mk('rn1', 50000), mk('rn2', 60000)] })
    );
    expect(result.errors.some((e) => e.includes('violates a unique constraint'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateBackupData: referential integrity
// ---------------------------------------------------------------------------

describe('validateBackupData: referential integrity', () => {
  test('expense referencing non-existent vehicle fails', () => {
    const backup: ParsedBackupData = {
      metadata: {
        version: CONFIG.backup.currentVersion,
        timestamp: new Date().toISOString(),
        userId: 'u1',
      },
      vehicles: [],
      expenses: [coerceRow(buildMinimalStringRow(expenses, { vehicleId: 'ghost' }), expenses)],
      financing: [],
      insurance: [],
      insuranceTerms: [],
      insuranceTermVehicles: [],
      userPreferences: [],
      syncState: [],
      photos: [],
      odometer: [],
      photoRefs: [],
    };
    const result = backupService.validateBackupData(backup);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-existent vehicle'))).toBe(true);
  });

  test('term-vehicle junction row referencing non-existent term fails', () => {
    const v = coerceRow(buildMinimalStringRow(vehicles, { userId: 'u1' }), vehicles);
    const backup: ParsedBackupData = {
      metadata: {
        version: CONFIG.backup.currentVersion,
        timestamp: new Date().toISOString(),
        userId: 'u1',
      },
      vehicles: [v],
      expenses: [],
      financing: [],
      insurance: [],
      insuranceTerms: [],
      insuranceTermVehicles: [{ termId: 'ghost', vehicleId: v.id as string }],
      userPreferences: [],
      syncState: [],
      photos: [],
      odometer: [],
      photoRefs: [],
    };
    const result = backupService.validateBackupData(backup);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-existent term'))).toBe(true);
  });

  test('term-vehicle junction row referencing non-existent vehicle fails', () => {
    const ins = coerceRow(buildMinimalStringRow(insurancePolicies), insurancePolicies);
    const backup: ParsedBackupData = {
      metadata: {
        version: CONFIG.backup.currentVersion,
        timestamp: new Date().toISOString(),
        userId: 'u1',
      },
      vehicles: [],
      expenses: [],
      financing: [],
      insurance: [ins],
      insuranceTerms: [
        { id: 'it1', policyId: ins.id as string, startDate: '2025-01-01', endDate: '2025-12-31' },
      ],
      insuranceTermVehicles: [{ termId: 'it1', vehicleId: 'ghost' }],
      userPreferences: [],
      syncState: [],
      photos: [],
      odometer: [],
      photoRefs: [],
    };
    const result = backupService.validateBackupData(backup);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-existent vehicle'))).toBe(true);
  });

  test('insurance claim referencing a known policy passes (round-trips)', () => {
    const ins = coerceRow(buildMinimalStringRow(insurancePolicies), insurancePolicies);
    const backup: ParsedBackupData = {
      metadata: {
        version: CONFIG.backup.currentVersion,
        timestamp: new Date().toISOString(),
        userId: 'u1',
      },
      vehicles: [],
      expenses: [],
      financing: [],
      insurance: [ins],
      insuranceTerms: [],
      insuranceTermVehicles: [],
      insuranceClaims: [
        coerceRow(
          buildMinimalStringRow(insuranceClaims, {
            policyId: ins.id as string,
            claimType: 'collision',
            status: 'filed',
            // No optional links — buildMinimalStringRow would otherwise fill
            // term_id/vehicle_id with dummy ids that fail the ref-check.
            termId: '',
            vehicleId: '',
          }),
          insuranceClaims
        ),
      ],
      userPreferences: [],
      syncState: [],
      photos: [],
      odometer: [],
      photoRefs: [],
    };
    const result = backupService.validateBackupData(backup);
    expect(result.valid, JSON.stringify(result.errors)).toBe(true);
  });

  test('insurance claim referencing a non-existent policy fails', () => {
    const backup: ParsedBackupData = {
      metadata: {
        version: CONFIG.backup.currentVersion,
        timestamp: new Date().toISOString(),
        userId: 'u1',
      },
      vehicles: [],
      expenses: [],
      financing: [],
      insurance: [],
      insuranceTerms: [],
      insuranceTermVehicles: [],
      insuranceClaims: [
        coerceRow(
          buildMinimalStringRow(insuranceClaims, { policyId: 'ghost', claimType: 'theft' }),
          insuranceClaims
        ),
      ],
      userPreferences: [],
      syncState: [],
      photos: [],
      odometer: [],
      photoRefs: [],
    };
    const result = backupService.validateBackupData(backup);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-existent policy'))).toBe(true);
  });

  test('photo referencing non-existent vehicle fails', () => {
    const photo = coerceRow(
      buildMinimalStringRow(photos, { entityType: 'vehicle', entityId: 'ghost' }),
      photos
    );
    const backup: ParsedBackupData = {
      metadata: {
        version: CONFIG.backup.currentVersion,
        timestamp: new Date().toISOString(),
        userId: 'u1',
      },
      vehicles: [],
      expenses: [],
      financing: [],
      insurance: [],
      insuranceTerms: [],
      insuranceTermVehicles: [],
      userPreferences: [],
      syncState: [],
      photos: [photo],
      odometer: [],
      photoRefs: [],
    };
    const result = backupService.validateBackupData(backup);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-existent vehicle'))).toBe(true);
  });

  test('photo with unknown entity type fails', () => {
    const photo = coerceRow(
      buildMinimalStringRow(photos, { entityType: 'unknown_type', entityId: 'some-id' }),
      photos
    );
    const backup: ParsedBackupData = {
      metadata: {
        version: CONFIG.backup.currentVersion,
        timestamp: new Date().toISOString(),
        userId: 'u1',
      },
      vehicles: [],
      expenses: [],
      financing: [],
      insurance: [],
      insuranceTerms: [],
      insuranceTermVehicles: [],
      userPreferences: [],
      syncState: [],
      photos: [photo],
      odometer: [],
      photoRefs: [],
    };
    const result = backupService.validateBackupData(backup);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown entity type'))).toBe(true);
  });

  test('rejects photoRef referencing non-existent photo', () => {
    const v = coerceRow(buildMinimalStringRow(vehicles, { userId: 'u1' }), vehicles);
    const backup: ParsedBackupData = {
      metadata: {
        version: CONFIG.backup.currentVersion,
        timestamp: new Date().toISOString(),
        userId: 'u1',
      },
      vehicles: [v],
      expenses: [],
      financing: [],
      insurance: [],
      insuranceTerms: [],
      insuranceTermVehicles: [],
      userPreferences: [],
      syncState: [],
      photos: [],
      odometer: [],
      photoRefs: [
        {
          id: 'ref-1',
          photoId: 'nonexistent-photo',
          providerId: 'p1',
          storageRef: 'abc',
          status: 'active',
        },
      ],
    };
    const result = backupService.validateBackupData(backup);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes('non-existent photo'))).toBe(true);
  });

  test('accepts valid photoRef referencing existing photo', () => {
    const v = coerceRow(buildMinimalStringRow(vehicles, { userId: 'u1' }), vehicles);
    const photo = coerceRow(
      buildMinimalStringRow(photos, { entityType: 'vehicle', entityId: v.id as string }),
      photos
    );
    const backup: ParsedBackupData = {
      metadata: {
        version: CONFIG.backup.currentVersion,
        timestamp: new Date().toISOString(),
        userId: 'u1',
      },
      vehicles: [v],
      expenses: [],
      financing: [],
      insurance: [],
      insuranceTerms: [],
      insuranceTermVehicles: [],
      userPreferences: [],
      syncState: [],
      photos: [photo],
      odometer: [],
      photoRefs: [
        {
          id: 'ref-1',
          photoId: photo.id as string,
          providerId: 'p1',
          storageRef: 'drive-abc',
          status: 'active',
        },
      ],
    };
    const result = backupService.validateBackupData(backup);
    expect(result.valid).toBe(true);
  });

  test('odometer entry referencing non-existent vehicle fails', () => {
    const entry = coerceRow(
      buildMinimalStringRow(odometerEntries, { vehicleId: 'ghost' }),
      odometerEntries
    );
    const backup: ParsedBackupData = {
      metadata: {
        version: CONFIG.backup.currentVersion,
        timestamp: new Date().toISOString(),
        userId: 'u1',
      },
      vehicles: [],
      expenses: [],
      financing: [],
      insurance: [],
      insuranceTerms: [],
      insuranceTermVehicles: [],
      userPreferences: [],
      syncState: [],
      photos: [],
      odometer: [entry],
      photoRefs: [],
    };
    const result = backupService.validateBackupData(backup);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-existent vehicle'))).toBe(true);
  });

  // C205 (arch dedup convergence guard): financing / odometer / trips each own purely via a vehicleId FK,
  // and their three byte-identical ref-checks were converged onto one shared `validateVehicleFkRefs(rows,
  // vehicleIds, label)` helper (the C202 trips addition tipped the rule-of-three). The convergence is
  // behavior-preserving ONLY if each caller still emits its EXACT prior message — a future "simplify the
  // label" edit to the shared helper could silently change one entity's validation text (which a restore
  // UI / a log consumer may match on). This drives all THREE through the public validateBackupData with a
  // bogus vehicleId and asserts the precise per-entity string survives. Non-vacuous: change any label in
  // the helper's callers and the matching assertion goes RED.
  const VEHICLE_FK_CASES: {
    label: string;
    table: Parameters<typeof getTableColumns>[0];
    key: keyof ParsedBackupData;
  }[] = [
    { label: 'Financing', table: vehicleFinancing, key: 'financing' },
    { label: 'Odometer entry', table: odometerEntries, key: 'odometer' },
    { label: 'Trip', table: trips, key: 'trips' },
  ];

  for (const { label, table, key } of VEHICLE_FK_CASES) {
    test(`${label} row referencing a non-existent vehicle fails with its exact label (C205 convergence)`, () => {
      const row = coerceRow(buildMinimalStringRow(table, { vehicleId: 'ghost' }), table);
      const base: ParsedBackupData = {
        metadata: {
          version: CONFIG.backup.currentVersion,
          timestamp: new Date().toISOString(),
          userId: 'u1',
        },
        vehicles: [],
        expenses: [],
        financing: [],
        insurance: [],
        insuranceTerms: [],
        insuranceTermVehicles: [],
        userPreferences: [],
        syncState: [],
        photos: [],
        odometer: [],
        photoRefs: [],
      };
      const backup: ParsedBackupData = { ...base, [key]: [row] };
      const result = backupService.validateBackupData(backup);
      expect(result.valid).toBe(false);
      // The EXACT message contract each converged caller must still produce: "<Label> <id> references
      // non-existent vehicle". A regression renaming a caller's label fails only its own case here.
      expect(
        result.errors.some((e) => e === `${label} ${row.id} references non-existent vehicle`),
        `expected the exact "${label} <id> references non-existent vehicle" message; got: ${JSON.stringify(result.errors)}`
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// coerceRow: Odometer entry columns
// ---------------------------------------------------------------------------

describe('coerceRow: Odometer entry columns', () => {
  test('integer odometer string coerces to number', () => {
    const row = buildMinimalStringRow(odometerEntries, { odometer: '98765' });
    const result = coerceRow(row, odometerEntries);
    expect(result.odometer).toBe(98765);
  });

  test('nullable text note coerces correctly when present', () => {
    const row = buildMinimalStringRow(odometerEntries, { note: 'Oil change visit' });
    const result = coerceRow(row, odometerEntries);
    expect(result.note).toBe('Oil change visit');
  });

  test('empty note coerces to null', () => {
    const row = buildMinimalStringRow(odometerEntries, { note: '' });
    const result = coerceRow(row, odometerEntries);
    expect(result.note).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TABLE_SCHEMA_MAP coverage: every table has a schema entry
// ---------------------------------------------------------------------------

describe('TABLE_SCHEMA_MAP coverage', () => {
  test('all expected backup tables are registered', () => {
    const expected = [
      'vehicles',
      'expenses',
      'financing',
      'insurance',
      'insuranceTerms',
      'insuranceTermVehicles',
      'photos',
      'odometer',
      'photoRefs',
      'userPreferences',
      'syncState',
    ];
    for (const key of expected) {
      expect(TABLE_SCHEMA_MAP[key]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Property 9: Backup round-trip for tracking flags
// **Validates: Requirements 6.1, 6.2**
// ---------------------------------------------------------------------------

describe('Property 9: Backup round-trip for tracking flags', () => {
  /** Map boolean to CSV string representations that a backup might produce. */
  const boolStringArb = fc.constantFrom('true', 'false', '1', '0', 'TRUE', 'FALSE');

  test('coerceRow preserves arbitrary trackFuel/trackCharging boolean values from CSV strings', () => {
    fc.assert(
      fc.property(boolStringArb, boolStringArb, (trackFuelStr, trackChargingStr) => {
        const expectedTrackFuel =
          trackFuelStr === 'true' || trackFuelStr === '1' || trackFuelStr === 'TRUE';
        const expectedTrackCharging =
          trackChargingStr === 'true' || trackChargingStr === '1' || trackChargingStr === 'TRUE';

        const row = buildMinimalStringRow(vehicles, {
          trackFuel: trackFuelStr,
          trackCharging: trackChargingStr,
        });
        const coerced = coerceRow(row, vehicles);

        expect(coerced.trackFuel).toBe(expectedTrackFuel);
        expect(coerced.trackCharging).toBe(expectedTrackCharging);
      }),
      { numRuns: 50 }
    );
  });

  test('coerced vehicle with tracking flags passes Zod insert schema validation', () => {
    fc.assert(
      fc.property(boolStringArb, boolStringArb, (trackFuelStr, trackChargingStr) => {
        const row = buildMinimalStringRow(vehicles, {
          trackFuel: trackFuelStr,
          trackCharging: trackChargingStr,
        });
        const coerced = coerceRow(row, vehicles);
        const schema = createInsertSchema(vehicles);
        const result = schema.safeParse(coerced);

        if (!result.success) {
          const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
          throw new Error(`Vehicle validation failed:\n${issues.join('\n')}`);
        }
        expect(result.success).toBe(true);
      }),
      { numRuns: 50 }
    );
  });

  test('coerced vehicle with tracking flags passes validateBackupData', () => {
    fc.assert(
      fc.property(boolStringArb, boolStringArb, (trackFuelStr, trackChargingStr) => {
        const vehicle = coerceRow(
          buildMinimalStringRow(vehicles, {
            userId: 'u1',
            trackFuel: trackFuelStr,
            trackCharging: trackChargingStr,
          }),
          vehicles
        );
        const backup: ParsedBackupData = {
          metadata: {
            version: CONFIG.backup.currentVersion,
            timestamp: new Date().toISOString(),
            userId: 'u1',
          },
          vehicles: [vehicle],
          expenses: [],
          financing: [],
          insurance: [],
          insuranceTerms: [],
          insuranceTermVehicles: [],
          userPreferences: [],
          syncState: [],
          photos: [],
          odometer: [],
          photoRefs: [],
        };

        const result = backupService.validateBackupData(backup);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 50 }
    );
  });

  test('older backups missing trackFuel/trackCharging get correct defaults', () => {
    // Simulate an older backup row that lacks the tracking flag columns entirely
    const row = buildMinimalStringRow(vehicles, { userId: 'u1' });
    delete (row as Record<string, unknown>).trackFuel;
    delete (row as Record<string, unknown>).trackCharging;

    const coerced = coerceRow(row, vehicles);

    // Schema defaults: trackFuel=true, trackCharging=false
    expect(coerced.trackFuel).toBe(true);
    expect(coerced.trackCharging).toBe(false);

    // Must still pass validation
    const schema = createInsertSchema(vehicles);
    const result = schema.safeParse(coerced);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// coerceRow: unitPreferences JSON round-trip on vehicles
// **Validates: Requirements 9.5, 10.1**
// ---------------------------------------------------------------------------

describe('coerceRow: unitPreferences JSON column on vehicles', () => {
  test('valid unitPreferences JSON string is parsed correctly', () => {
    const prefs = JSON.stringify({
      distanceUnit: 'kilometers',
      volumeUnit: 'liters',
      chargeUnit: 'kwh',
    });
    const row = buildMinimalStringRow(vehicles, { unitPreferences: prefs });
    const result = coerceRow(row, vehicles);
    expect(result.unitPreferences).toEqual({
      distanceUnit: 'kilometers',
      volumeUnit: 'liters',
      chargeUnit: 'kwh',
    });
  });

  test('default unitPreferences JSON string is parsed correctly', () => {
    const prefs = JSON.stringify({
      distanceUnit: 'miles',
      volumeUnit: 'gallons_us',
      chargeUnit: 'kwh',
    });
    const row = buildMinimalStringRow(vehicles, { unitPreferences: prefs });
    const result = coerceRow(row, vehicles);
    expect(result.unitPreferences).toEqual({
      distanceUnit: 'miles',
      volumeUnit: 'gallons_us',
      chargeUnit: 'kwh',
    });
  });

  test('coerced vehicle with unitPreferences passes Zod validation', () => {
    const prefs = JSON.stringify({
      distanceUnit: 'kilometers',
      volumeUnit: 'gallons_uk',
      chargeUnit: 'kwh',
    });
    const row = buildMinimalStringRow(vehicles, { unitPreferences: prefs, userId: 'u1' });
    const coerced = coerceRow(row, vehicles);
    const schema = createInsertSchema(vehicles);
    const result = schema.safeParse(coerced);
    expect(result.success).toBe(true);
  });

  test('older backup missing unitPreferences column gets schema default', () => {
    const row = buildMinimalStringRow(vehicles, { userId: 'u1' });
    delete (row as Record<string, unknown>).unitPreferences;

    const coerced = coerceRow(row, vehicles);

    // unitPreferences is undefined — Drizzle will use the schema default on insert
    // The Zod schema from createInsertSchema should accept undefined for columns with defaults
    const schema = createInsertSchema(vehicles);
    const result = schema.safeParse(coerced);
    expect(result.success).toBe(true);
  });

  test('coerced vehicle with unitPreferences passes validateBackupData', () => {
    const prefs = JSON.stringify({
      distanceUnit: 'kilometers',
      volumeUnit: 'liters',
      chargeUnit: 'kwh',
    });
    const vehicle = coerceRow(
      buildMinimalStringRow(vehicles, { userId: 'u1', unitPreferences: prefs }),
      vehicles
    );
    const backup: ParsedBackupData = {
      metadata: {
        version: CONFIG.backup.currentVersion,
        timestamp: new Date().toISOString(),
        userId: 'u1',
      },
      vehicles: [vehicle],
      expenses: [],
      financing: [],
      insurance: [],
      insuranceTerms: [],
      insuranceTermVehicles: [],
      userPreferences: [],
      syncState: [],
      photos: [],
      odometer: [],
      photoRefs: [],
    };

    const result = backupService.validateBackupData(backup);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('invalid unitPreferences JSON coerces to null', () => {
    const row = buildMinimalStringRow(vehicles, { unitPreferences: '{broken-json' });
    const result = coerceRow(row, vehicles);
    expect(result.unitPreferences).toBeNull();
  });
});
