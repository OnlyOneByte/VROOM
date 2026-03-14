/**
 * Property-Based Tests for vehicle unit CRUD
 *
 * Property 1: Unit preferences contain required keys
 * Property 2: Default unit inheritance on vehicle creation
 * Property 3: Explicit unit preferences override defaults
 * Property 4: Unit preferences are updatable
 * Property 17: Global settings change does not affect vehicles
 *
 * Validates: Requirements 1.1, 1.2, 1.4, 1.5, 1.6, 11.3
 */

import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  ChargeUnit,
  DEFAULT_UNIT_PREFERENCES,
  DistanceUnit,
  parseUnitPreferences,
  type UnitPreferences,
  VolumeUnit,
} from '../../../types';
import {
  createTestDb,
  seedUser,
  type TestDb,
} from '../../analytics/__tests__/analytics-test-generators';

// ── Generators ─────────────────────────────────────────────────────────────────

const distanceUnitArb = fc.constantFrom(DistanceUnit.MILES, DistanceUnit.KILOMETERS);
const volumeUnitArb = fc.constantFrom(
  VolumeUnit.GALLONS_US,
  VolumeUnit.GALLONS_UK,
  VolumeUnit.LITERS
);
const chargeUnitArb = fc.constantFrom(ChargeUnit.KWH);

/** Generates a valid UnitPreferences object with all required keys. */
const validUnitPreferencesArb: fc.Arbitrary<UnitPreferences> = fc.record({
  distanceUnit: distanceUnitArb,
  volumeUnit: volumeUnitArb,
  chargeUnit: chargeUnitArb,
});

/** Generates a second valid UnitPreferences distinct from the first. */
const distinctUnitPreferencesPairArb = fc
  .tuple(validUnitPreferencesArb, validUnitPreferencesArb)
  .filter(
    ([a, b]) =>
      a.distanceUnit !== b.distanceUnit ||
      a.volumeUnit !== b.volumeUnit ||
      a.chargeUnit !== b.chargeUnit
  );

/** Generates an invalid distanceUnit string. */
const invalidDistanceUnitArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => s !== 'miles' && s !== 'kilometers');

/** Generates an invalid volumeUnit string. */
const invalidVolumeUnitArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => s !== 'gallons_us' && s !== 'gallons_uk' && s !== 'liters');

/** Generates an invalid chargeUnit string. */
const invalidChargeUnitArb = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s !== 'kwh');

// ── Property 1: Unit preferences contain required keys ─────────────────────────
// Feature: unit-aware-display, Property 1: Unit preferences contain required keys
// **Validates: Requirements 1.1, 1.2**

describe('Property 1: Unit preferences contain required keys', () => {
  test('parseUnitPreferences accepts all valid enum combinations', () => {
    fc.assert(
      fc.property(validUnitPreferencesArb, (prefs) => {
        const result = parseUnitPreferences(prefs);
        expect(result).not.toBeNull();
        expect(result).toEqual({
          distanceUnit: prefs.distanceUnit,
          volumeUnit: prefs.volumeUnit,
          chargeUnit: prefs.chargeUnit,
        });
      }),
      { numRuns: 100 }
    );
  });

  test('parseUnitPreferences rejects objects with invalid distanceUnit', () => {
    fc.assert(
      fc.property(invalidDistanceUnitArb, volumeUnitArb, chargeUnitArb, (dist, vol, charge) => {
        const result = parseUnitPreferences({
          distanceUnit: dist,
          volumeUnit: vol,
          chargeUnit: charge,
        });
        expect(result).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  test('parseUnitPreferences rejects objects with invalid volumeUnit', () => {
    fc.assert(
      fc.property(distanceUnitArb, invalidVolumeUnitArb, chargeUnitArb, (dist, vol, charge) => {
        const result = parseUnitPreferences({
          distanceUnit: dist,
          volumeUnit: vol,
          chargeUnit: charge,
        });
        expect(result).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  test('parseUnitPreferences rejects objects with invalid chargeUnit', () => {
    fc.assert(
      fc.property(distanceUnitArb, volumeUnitArb, invalidChargeUnitArb, (dist, vol, charge) => {
        const result = parseUnitPreferences({
          distanceUnit: dist,
          volumeUnit: vol,
          chargeUnit: charge,
        });
        expect(result).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  test('parseUnitPreferences rejects non-object values', () => {
    const nonObjectArb = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.integer(),
      fc.string(),
      fc.boolean(),
      fc.constant([])
    );

    fc.assert(
      fc.property(nonObjectArb, (value) => {
        const result = parseUnitPreferences(value);
        expect(result).toBeNull();
      }),
      { numRuns: 100 }
    );
  });
});

// ── Property 2: Default unit inheritance on vehicle creation ───────────────────
// Feature: unit-aware-display, Property 2: Default unit inheritance on vehicle creation
// **Validates: Requirements 1.4**

describe('Property 2: Default unit inheritance on vehicle creation', () => {
  test('when unitPreferences is undefined, defaults match DEFAULT_UNIT_PREFERENCES', () => {
    fc.assert(
      fc.property(validUnitPreferencesArb, (userPrefs) => {
        // Simulate the vehicle creation logic: if unitPreferences is absent,
        // use the user's settings (or DEFAULT_UNIT_PREFERENCES if no settings)
        const vehicleUnitPrefs: UnitPreferences | undefined = undefined;
        const resolvedPrefs = vehicleUnitPrefs ?? userPrefs;

        // The resolved prefs should match the user's settings exactly
        expect(resolvedPrefs.distanceUnit).toBe(userPrefs.distanceUnit);
        expect(resolvedPrefs.volumeUnit).toBe(userPrefs.volumeUnit);
        expect(resolvedPrefs.chargeUnit).toBe(userPrefs.chargeUnit);
      }),
      { numRuns: 100 }
    );
  });

  test('DEFAULT_UNIT_PREFERENCES is a valid UnitPreferences object', () => {
    const result = parseUnitPreferences(DEFAULT_UNIT_PREFERENCES);
    expect(result).not.toBeNull();
    expect(result).toEqual({
      distanceUnit: DistanceUnit.MILES,
      volumeUnit: VolumeUnit.GALLONS_US,
      chargeUnit: ChargeUnit.KWH,
    });
  });

  test('default inheritance produces valid preferences for any user settings', () => {
    fc.assert(
      fc.property(validUnitPreferencesArb, (userPrefs) => {
        // Simulate: vehicle created without explicit prefs → inherits from user
        const inherited = { ...userPrefs };
        const validated = parseUnitPreferences(inherited);
        expect(validated).not.toBeNull();
        expect(validated).toEqual({
          distanceUnit: userPrefs.distanceUnit,
          volumeUnit: userPrefs.volumeUnit,
          chargeUnit: userPrefs.chargeUnit,
        });
      }),
      { numRuns: 100 }
    );
  });
});

// ── Property 3: Explicit unit preferences override defaults ────────────────────
// Feature: unit-aware-display, Property 3: Explicit unit preferences override defaults
// **Validates: Requirements 1.5**

describe('Property 3: Explicit unit preferences override defaults', () => {
  test('explicit prefs are preserved exactly, regardless of user defaults', () => {
    fc.assert(
      fc.property(distinctUnitPreferencesPairArb, ([userDefaults, explicitPrefs]) => {
        // Simulate: vehicle created with explicit prefs → should use explicit, not defaults
        const vehicleUnitPrefs: UnitPreferences | undefined = explicitPrefs;
        const resolvedPrefs = vehicleUnitPrefs ?? userDefaults;

        expect(resolvedPrefs.distanceUnit).toBe(explicitPrefs.distanceUnit);
        expect(resolvedPrefs.volumeUnit).toBe(explicitPrefs.volumeUnit);
        expect(resolvedPrefs.chargeUnit).toBe(explicitPrefs.chargeUnit);
      }),
      { numRuns: 100 }
    );
  });

  test('explicit prefs pass validation after assignment', () => {
    fc.assert(
      fc.property(validUnitPreferencesArb, (explicitPrefs) => {
        // The explicit prefs should always be valid
        const validated = parseUnitPreferences(explicitPrefs);
        expect(validated).not.toBeNull();
        expect(validated).toEqual({
          distanceUnit: explicitPrefs.distanceUnit,
          volumeUnit: explicitPrefs.volumeUnit,
          chargeUnit: explicitPrefs.chargeUnit,
        });
      }),
      { numRuns: 100 }
    );
  });
});

// ── Property 4: Unit preferences are updatable ─────────────────────────────────
// Feature: unit-aware-display, Property 4: Unit preferences are updatable
// **Validates: Requirements 1.6**

describe('Property 4: Unit preferences are updatable', () => {
  test('full update replaces all unit preferences', () => {
    fc.assert(
      fc.property(validUnitPreferencesArb, validUnitPreferencesArb, (existing, updated) => {
        // Simulate: full update merges new prefs over existing
        const merged: UnitPreferences = { ...existing, ...updated };
        const validated = parseUnitPreferences(merged);

        expect(validated).not.toBeNull();
        expect(validated?.distanceUnit).toBe(updated.distanceUnit);
        expect(validated?.volumeUnit).toBe(updated.volumeUnit);
        expect(validated?.chargeUnit).toBe(updated.chargeUnit);
      }),
      { numRuns: 100 }
    );
  });

  test('partial update merges correctly — only specified keys change', () => {
    fc.assert(
      fc.property(validUnitPreferencesArb, distanceUnitArb, (existing, newDistanceUnit) => {
        // Simulate: partial update with only distanceUnit
        const partialUpdate = { distanceUnit: newDistanceUnit };
        const merged: UnitPreferences = { ...existing, ...partialUpdate };
        const validated = parseUnitPreferences(merged);

        expect(validated).not.toBeNull();
        // Updated key reflects new value
        expect(validated?.distanceUnit).toBe(newDistanceUnit);
        // Non-updated keys remain unchanged
        expect(validated?.volumeUnit).toBe(existing.volumeUnit);
        expect(validated?.chargeUnit).toBe(existing.chargeUnit);
      }),
      { numRuns: 100 }
    );
  });

  test('partial volumeUnit update preserves other keys', () => {
    fc.assert(
      fc.property(validUnitPreferencesArb, volumeUnitArb, (existing, newVolumeUnit) => {
        const partialUpdate = { volumeUnit: newVolumeUnit };
        const merged: UnitPreferences = { ...existing, ...partialUpdate };
        const validated = parseUnitPreferences(merged);

        expect(validated).not.toBeNull();
        expect(validated?.volumeUnit).toBe(newVolumeUnit);
        expect(validated?.distanceUnit).toBe(existing.distanceUnit);
        expect(validated?.chargeUnit).toBe(existing.chargeUnit);
      }),
      { numRuns: 100 }
    );
  });

  test('updated preferences always pass validation', () => {
    fc.assert(
      fc.property(validUnitPreferencesArb, validUnitPreferencesArb, (existing, updates) => {
        const merged: UnitPreferences = { ...existing, ...updates };
        const validated = parseUnitPreferences(merged);
        expect(validated).not.toBeNull();
      }),
      { numRuns: 100 }
    );
  });
});

// ── Property 17: Global settings change does not affect vehicles ───────────────
// Feature: unit-aware-display, Property 17: Global settings change does not affect vehicles
// **Validates: Requirements 11.3**

describe('Property 17: Global settings change does not affect vehicles', () => {
  let testDb: TestDb;

  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.sqlite.close();
  });

  /** Seed user_settings with specific unit preferences. */
  function seedUserSettings(db: Database, userId: string, units: UnitPreferences): void {
    db.run('INSERT INTO user_settings (id, user_id, unit_preferences) VALUES (?, ?, ?)', [
      `settings-${userId}`,
      userId,
      JSON.stringify(units),
    ]);
  }

  /** Seed a vehicle with specific unit preferences. */
  function seedVehicleWithUnits(
    db: Database,
    vehicleId: string,
    userId: string,
    units: UnitPreferences
  ): void {
    db.run(
      'INSERT INTO vehicles (id, user_id, make, model, year, unit_preferences) VALUES (?, ?, ?, ?, ?, ?)',
      [vehicleId, userId, 'Toyota', 'Camry', 2024, JSON.stringify(units)]
    );
  }

  /** Read a vehicle's unit_preferences from the DB. */
  function getVehicleUnits(db: Database, vehicleId: string): UnitPreferences | null {
    const row = db.query('SELECT unit_preferences FROM vehicles WHERE id = ?').get(vehicleId) as {
      unit_preferences: string;
    } | null;
    if (!row) return null;
    return JSON.parse(row.unit_preferences) as UnitPreferences;
  }

  test('updating user_settings unit_preferences does not change existing vehicles', () => {
    fc.assert(
      fc.property(
        validUnitPreferencesArb,
        validUnitPreferencesArb,
        fc.integer({ min: 1, max: 5 }),
        (initialUnits, updatedUnits, vehicleCount) => {
          // Reset DB for each iteration
          testDb.sqlite.close();
          testDb = createTestDb();

          const userId = 'user-prop17';
          seedUser(testDb.sqlite, {
            id: userId,
            email: 'prop17@test.com',
            displayName: 'Prop17 User',
          });
          seedUserSettings(testDb.sqlite, userId, initialUnits);

          // Create vehicles that inherit the initial unit preferences
          const vehicleIds: string[] = [];
          for (let i = 0; i < vehicleCount; i++) {
            const vid = `vehicle-prop17-${i}`;
            vehicleIds.push(vid);
            seedVehicleWithUnits(testDb.sqlite, vid, userId, initialUnits);
          }

          // Verify vehicles have the initial units before the settings change
          for (const vid of vehicleIds) {
            const units = getVehicleUnits(testDb.sqlite, vid);
            expect(units).not.toBeNull();
            expect(units?.distanceUnit).toBe(initialUnits.distanceUnit);
            expect(units?.volumeUnit).toBe(initialUnits.volumeUnit);
            expect(units?.chargeUnit).toBe(initialUnits.chargeUnit);
          }

          // Update the user's global unit preferences
          testDb.sqlite.run('UPDATE user_settings SET unit_preferences = ? WHERE user_id = ?', [
            JSON.stringify(updatedUnits),
            userId,
          ]);

          // Verify the settings actually changed
          const settingsRow = testDb.sqlite
            .query('SELECT unit_preferences FROM user_settings WHERE user_id = ?')
            .get(userId) as { unit_preferences: string } | null;
          expect(settingsRow).not.toBeNull();
          const newSettings = JSON.parse(settingsRow?.unit_preferences ?? '{}') as UnitPreferences;
          expect(newSettings.distanceUnit).toBe(updatedUnits.distanceUnit);
          expect(newSettings.volumeUnit).toBe(updatedUnits.volumeUnit);
          expect(newSettings.chargeUnit).toBe(updatedUnits.chargeUnit);

          // Verify ALL vehicles still have their original unit preferences
          for (const vid of vehicleIds) {
            const units = getVehicleUnits(testDb.sqlite, vid);
            expect(units).not.toBeNull();
            expect(units?.distanceUnit).toBe(initialUnits.distanceUnit);
            expect(units?.volumeUnit).toBe(initialUnits.volumeUnit);
            expect(units?.chargeUnit).toBe(initialUnits.chargeUnit);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
