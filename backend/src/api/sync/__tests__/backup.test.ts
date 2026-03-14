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
import { TABLE_SCHEMA_MAP } from '../../../config';
import {
  expenses,
  insurancePolicies,
  odometerEntries,
  photos,
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
    const row = buildMinimalStringRow(expenses, { missedFillup: '', isFinancingPayment: '' });
    const result = coerceRow(row, expenses);
    expect(result.missedFillup).toBe(false);
    expect(result.isFinancingPayment).toBe(false);
  });

  test('null on NOT NULL boolean defaults to false', () => {
    const row = buildMinimalStringRow(expenses, {});
    row.missedFillup = null as unknown as string;
    row.isFinancingPayment = null as unknown as string;
    const result = coerceRow(row, expenses);
    expect(result.missedFillup).toBe(false);
    expect(result.isFinancingPayment).toBe(false);
  });

  test('undefined on NOT NULL boolean defaults to false', () => {
    const row = buildMinimalStringRow(expenses, {});
    delete (row as Record<string, unknown>).missedFillup;
    delete (row as Record<string, unknown>).isFinancingPayment;
    const result = coerceRow(row, expenses);
    expect(result.missedFillup).toBe(false);
    expect(result.isFinancingPayment).toBe(false);
  });

  test('"null" string on NOT NULL boolean defaults to false', () => {
    const row = buildMinimalStringRow(expenses, {
      missedFillup: 'null',
      isFinancingPayment: 'NULL',
    });
    const result = coerceRow(row, expenses);
    expect(result.missedFillup).toBe(false);
    expect(result.isFinancingPayment).toBe(false);
  });

  test('"true" string coerces to true', () => {
    const row = buildMinimalStringRow(expenses, {
      missedFillup: 'true',
      isFinancingPayment: 'TRUE',
    });
    const result = coerceRow(row, expenses);
    expect(result.missedFillup).toBe(true);
    expect(result.isFinancingPayment).toBe(true);
  });

  test('"1" string coerces to true', () => {
    const row = buildMinimalStringRow(expenses, { missedFillup: '1', isFinancingPayment: '1' });
    const result = coerceRow(row, expenses);
    expect(result.missedFillup).toBe(true);
    expect(result.isFinancingPayment).toBe(true);
  });

  test('"false" string coerces to false', () => {
    const row = buildMinimalStringRow(expenses, {
      missedFillup: 'false',
      isFinancingPayment: '0',
    });
    const result = coerceRow(row, expenses);
    expect(result.missedFillup).toBe(false);
    expect(result.isFinancingPayment).toBe(false);
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
  test('valid JSON string is parsed', () => {
    const terms = JSON.stringify([{ id: 't1', startDate: '2025-01-01', endDate: '2025-12-31' }]);
    const row = buildMinimalStringRow(insurancePolicies, { terms });
    const result = coerceRow(row, insurancePolicies);
    expect(Array.isArray(result.terms)).toBe(true);
    expect((result.terms as unknown[])[0]).toHaveProperty('id', 't1');
  });

  test('empty JSON column coerces to null', () => {
    const row = buildMinimalStringRow(insurancePolicies, { terms: '' });
    const result = coerceRow(row, insurancePolicies);
    expect(result.terms).toBeNull();
  });

  test('invalid JSON coerces to null', () => {
    const row = buildMinimalStringRow(insurancePolicies, { terms: '{broken' });
    const result = coerceRow(row, insurancePolicies);
    expect(result.terms).toBeNull();
  });

  test('tags JSON array on expenses is parsed', () => {
    const row = buildMinimalStringRow(expenses, { tags: '["oil-change","filter"]' });
    const result = coerceRow(row, expenses);
    expect(result.tags).toEqual(['oil-change', 'filter']);
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
    const row = buildMinimalStringRow(expenses, { expenseAmount: '123.45' });
    const result = coerceRow(row, expenses);
    expect(result.expenseAmount).toBe(123.45);
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
  test('expense with empty missedFillup and isFinancingPayment passes validation', () => {
    const row = buildMinimalStringRow(expenses, { missedFillup: '', isFinancingPayment: '' });
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
// validateBackupData: well-formed backup passes
// ---------------------------------------------------------------------------

describe('validateBackupData: acceptance', () => {
  test('valid parsed backup passes validation', () => {
    const backup: ParsedBackupData = {
      metadata: { version: '1.0.0', timestamp: new Date().toISOString(), userId: 'u1' },
      vehicles: [coerceRow(buildMinimalStringRow(vehicles, { userId: 'u1' }), vehicles)],
      expenses: [
        coerceRow(
          buildMinimalStringRow(expenses, {
            vehicleId: 'test-id',
            userId: 'u1',
            missedFillup: '',
            isFinancingPayment: '',
          }),
          expenses
        ),
      ],
      financing: [],
      insurance: [],
      insurancePolicyVehicles: [],
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
      metadata: { version: '1.0.0', timestamp: new Date().toISOString(), userId: 'u1' },
      vehicles: [vehicle],
      expenses: [],
      financing: [],
      insurance: [],
      insurancePolicyVehicles: [],
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
// validateBackupData: referential integrity
// ---------------------------------------------------------------------------

describe('validateBackupData: referential integrity', () => {
  test('expense referencing non-existent vehicle fails', () => {
    const backup: ParsedBackupData = {
      metadata: { version: '1.0.0', timestamp: new Date().toISOString(), userId: 'u1' },
      vehicles: [],
      expenses: [coerceRow(buildMinimalStringRow(expenses, { vehicleId: 'ghost' }), expenses)],
      financing: [],
      insurance: [],
      insurancePolicyVehicles: [],
      photos: [],
      odometer: [],
      photoRefs: [],
    };
    const result = backupService.validateBackupData(backup);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-existent vehicle'))).toBe(true);
  });

  test('junction row referencing non-existent policy fails', () => {
    const v = coerceRow(buildMinimalStringRow(vehicles, { userId: 'u1' }), vehicles);
    const backup: ParsedBackupData = {
      metadata: { version: '1.0.0', timestamp: new Date().toISOString(), userId: 'u1' },
      vehicles: [v],
      expenses: [],
      financing: [],
      insurance: [],
      insurancePolicyVehicles: [{ policyId: 'ghost', vehicleId: v.id as string }],
      photos: [],
      odometer: [],
      photoRefs: [],
    };
    const result = backupService.validateBackupData(backup);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-existent policy'))).toBe(true);
  });

  test('junction row referencing non-existent vehicle fails', () => {
    const ins = coerceRow(buildMinimalStringRow(insurancePolicies), insurancePolicies);
    const backup: ParsedBackupData = {
      metadata: { version: '1.0.0', timestamp: new Date().toISOString(), userId: 'u1' },
      vehicles: [],
      expenses: [],
      financing: [],
      insurance: [ins],
      insurancePolicyVehicles: [{ policyId: ins.id as string, vehicleId: 'ghost' }],
      photos: [],
      odometer: [],
      photoRefs: [],
    };
    const result = backupService.validateBackupData(backup);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-existent vehicle'))).toBe(true);
  });

  test('photo referencing non-existent vehicle fails', () => {
    const photo = coerceRow(
      buildMinimalStringRow(photos, { entityType: 'vehicle', entityId: 'ghost' }),
      photos
    );
    const backup: ParsedBackupData = {
      metadata: { version: '1.0.0', timestamp: new Date().toISOString(), userId: 'u1' },
      vehicles: [],
      expenses: [],
      financing: [],
      insurance: [],
      insurancePolicyVehicles: [],
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
      metadata: { version: '1.0.0', timestamp: new Date().toISOString(), userId: 'u1' },
      vehicles: [],
      expenses: [],
      financing: [],
      insurance: [],
      insurancePolicyVehicles: [],
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
      metadata: { version: '1.0.0', timestamp: new Date().toISOString(), userId: 'u1' },
      vehicles: [v],
      expenses: [],
      financing: [],
      insurance: [],
      insurancePolicyVehicles: [],
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
      metadata: { version: '1.0.0', timestamp: new Date().toISOString(), userId: 'u1' },
      vehicles: [v],
      expenses: [],
      financing: [],
      insurance: [],
      insurancePolicyVehicles: [],
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
      metadata: { version: '1.0.0', timestamp: new Date().toISOString(), userId: 'u1' },
      vehicles: [],
      expenses: [],
      financing: [],
      insurance: [],
      insurancePolicyVehicles: [],
      photos: [],
      odometer: [entry],
      photoRefs: [],
    };
    const result = backupService.validateBackupData(backup);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-existent vehicle'))).toBe(true);
  });
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

  test('nullable linkedEntityType coerces correctly when present', () => {
    const row = buildMinimalStringRow(odometerEntries, { linkedEntityType: 'expense' });
    const result = coerceRow(row, odometerEntries);
    expect(result.linkedEntityType).toBe('expense');
  });

  test('empty linkedEntityType coerces to null', () => {
    const row = buildMinimalStringRow(odometerEntries, { linkedEntityType: '' });
    const result = coerceRow(row, odometerEntries);
    expect(result.linkedEntityType).toBeNull();
  });

  test('nullable linkedEntityId coerces correctly when present', () => {
    const row = buildMinimalStringRow(odometerEntries, { linkedEntityId: 'exp-123' });
    const result = coerceRow(row, odometerEntries);
    expect(result.linkedEntityId).toBe('exp-123');
  });

  test('empty linkedEntityId coerces to null', () => {
    const row = buildMinimalStringRow(odometerEntries, { linkedEntityId: '' });
    const result = coerceRow(row, odometerEntries);
    expect(result.linkedEntityId).toBeNull();
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
      'insurancePolicyVehicles',
      'photos',
      'odometer',
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
          metadata: { version: '1.0.0', timestamp: new Date().toISOString(), userId: 'u1' },
          vehicles: [vehicle],
          expenses: [],
          financing: [],
          insurance: [],
          insurancePolicyVehicles: [],
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
      metadata: { version: '1.0.0', timestamp: new Date().toISOString(), userId: 'u1' },
      vehicles: [vehicle],
      expenses: [],
      financing: [],
      insurance: [],
      insurancePolicyVehicles: [],
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
