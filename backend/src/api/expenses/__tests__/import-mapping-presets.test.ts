/**
 * Unit tests for the import-tracker presets (spec T2). Exercises detectSource against each
 * preset's header signature + an unknown file, the substring/normalization tolerance that
 * keeps real-world header decoration from defeating detection, and presetToMapping producing
 * a valid T1 ColumnMapping. Pure — no server.
 *
 * NOTE: these assert the DETECTION MECHANISM, not that the hard-coded column strings exactly
 * match a real Fuelly/Fuelio/Drivvo export (that's validated against real files in T6). A
 * mis-detect is the safe failure — detectSource returns null and the user maps manually.
 */

import { describe, expect, test } from 'bun:test';
import { DistanceUnit, VolumeUnit } from '../../../types';
import { buildImportPlan, type ImportVehicle } from '../import-csv';
import { applyMapping } from '../import-mapping';
import {
  detectSource,
  MAPPING_PRESETS,
  normalizeHeader,
  presetToMapping,
} from '../import-mapping-presets';

describe('normalizeHeader', () => {
  test('lower-cases and strips every non-alphanumeric character', () => {
    expect(normalizeHeader('Odometer (km)')).toBe('odometerkm');
    expect(normalizeHeader('Fuel Type')).toBe('fueltype');
    expect(normalizeHeader('  Total price  ')).toBe('totalprice');
    expect(normalizeHeader('﻿Date')).toBe('date'); // a leading BOM is stripped too
  });
});

describe('detectSource — per-preset signatures', () => {
  test('detects a Fuelly export', () => {
    const headers = ['Date', 'Odometer', 'Fill Amount', 'Price', 'Fuel Type', 'Notes'];
    expect(detectSource(headers)?.id).toBe('fuelly');
  });

  test('detects a Fuelio export (metric, distinctive Odo/litres columns)', () => {
    const headers = ['Data', 'Odo (km)', 'Fuel (litres)', 'Full', 'Price'];
    expect(detectSource(headers)?.id).toBe('fuelio');
  });

  test('detects a Drivvo export', () => {
    const headers = ['Date', 'Odometer', 'Total price', 'Price per unit', 'Volume', 'Type of fuel'];
    expect(detectSource(headers)?.id).toBe('drivvo');
  });

  test('an unknown / generic file matches no preset (→ manual mapping)', () => {
    expect(detectSource(['Date', 'Amount', 'Category', 'Vehicle'])).toBeNull();
    expect(detectSource([])).toBeNull();
  });
});

describe('detectSource — robustness', () => {
  test('extra columns and case/spacing/punctuation drift still detect (substring match)', () => {
    // Decorated + reordered + extra columns — detection must still fire.
    const headers = ['NOTES', 'fill_amount!!', 'odometer (mi)', 'date', 'price', 'station'];
    expect(detectSource(headers)?.id).toBe('fuelly');
  });

  test('presets do not cross-detect: a Fuelio file is not read as Fuelly or Drivvo', () => {
    const fuelio = detectSource(['Data', 'Odo (km)', 'Fuel (litres)', 'Price']);
    expect(fuelio?.id).toBe('fuelio');
    // Fuelly needs `odometer` + `fillamount`; Drivvo needs `totalprice` + `typeoffuel` —
    // none are substrings of Fuelio's headers, so only Fuelio matches.
  });

  test('every preset detects its OWN seeded columns (self-consistency of signature vs columns)', () => {
    for (const preset of MAPPING_PRESETS) {
      const ownHeaders = Object.values(preset.columns);
      expect(
        detectSource(ownHeaders)?.id,
        `preset ${preset.id} should detect its own columns`
      ).toBe(preset.id);
    }
  });
});

describe('presetToMapping → applyMapping (presets feed a valid T1 ColumnMapping)', () => {
  test('a detected Fuelio preset maps a row end-to-end via applyMapping', () => {
    const headers = ['Data', 'Odo (km)', 'Fuel (litres)', 'Price'];
    const preset = detectSource(headers);
    expect(preset?.id).toBe('fuelio');
    if (!preset) throw new Error('expected Fuelio preset');

    const mapping = presetToMapping(preset, 'Daily Driver');
    expect(mapping.source).toBe('fuelio');
    expect(mapping.targetVehicle).toBe('Daily Driver');
    expect(mapping.dateFormat).toBe('dmy');
    expect(mapping.distanceUnit).toBe(DistanceUnit.KILOMETERS);
    expect(mapping.volumeUnit).toBe(VolumeUnit.LITERS);

    // Feed a row through the real T1 translator into a miles/US-gal vehicle.
    const csv = ['Data,Odo (km),Fuel (litres),Price', '15/03/2024,160.9344,37.854,52.40'].join(
      '\n'
    );
    const { csv: native } = applyMapping(csv, mapping, {
      distanceUnit: DistanceUnit.MILES,
      volumeUnit: VolumeUnit.GALLONS_US,
    });
    const [header, row] = native.split('\n');
    const cells = Object.fromEntries(header.split(',').map((h, i) => [h, row.split(',')[i]]));
    expect(cells.vehicle).toBe('Daily Driver'); // no vehicle column → targetVehicle injected
    expect(cells.mileage).toBe('100'); // 160.9344 km → 100 mi
    expect(Number(cells.volume)).toBeCloseTo(10, 2); // 37.854 L → ~10 US gal
    expect(cells.amount).toBe('52.40');
  });

  test('presetToMapping leaves targetVehicle undefined when not supplied', () => {
    const preset = MAPPING_PRESETS[0];
    const mapping = presetToMapping(preset);
    expect(mapping.targetVehicle).toBeUndefined();
    expect(mapping.columns).toEqual(preset.columns);
  });
});

// C148 FIX (Angelo-approved 2026-06-23, was the C31/C32 finding): the built-in fuel-log presets map NO
// category column (Fuelly/Fuelio/Drivvo refuel exports have no category field — they're definitionally
// all fuel), so applyMapping emitted a BLANK category cell and buildImportPlan errored EVERY row
// "Unknown category" → 0 ready. The fix gives each fuel preset `defaultCategory:'fuel'`, which fills ONLY
// a blank category cell (a NAMED-but-unrecognized word still falls back to misc — the C47 remap path is
// unchanged). These tests now PIN the fixed behavior: a detected fuel log produces ready `fuel` rows.
// (The C32 characterization that asserted 0-ready was flipped here when the fix landed.)
describe('MAPPING_PRESETS — fuel-tracker defaultCategory (C148, Angelo-approved fix)', () => {
  const vehicles: ImportVehicle[] = [
    { id: 'veh-1', make: 'Honda', model: 'Civic', year: 2020, nickname: 'Daily Driver' },
  ];

  // One representative real-export row per preset (headers are the preset's own column names).
  const PRESET_ROWS: Record<string, string> = {
    fuelly: [
      'Date,Odometer,Fill Amount,Price,Fuel Type,Notes',
      '03/01/2026,30000,9,36.00,Gas,x',
    ].join('\n'),
    fuelio: ['Data,Odo (km),Fuel (litres),Price,Notes', '01/03/2026,48280,34,52.00,x'].join('\n'),
    drivvo: [
      'Date,Odometer,Total price,Price per unit,Volume,Type of fuel,Observation',
      '01/03/2026,48280,52.00,1.53,34,Gas,x',
    ].join('\n'),
  };

  test('NONE of the presets map a category column (why the defaultCategory is needed)', () => {
    for (const preset of MAPPING_PRESETS) {
      expect(
        preset.columns.category,
        `${preset.id} should have no category column`
      ).toBeUndefined();
    }
  });

  test('every fuel-tracker preset declares defaultCategory: fuel', () => {
    for (const preset of MAPPING_PRESETS) {
      expect(preset.defaultCategory, `${preset.id} defaultCategory`).toBe('fuel');
    }
  });

  test('every preset now yields READY fuel rows end-to-end (the fix flips 0-ready → fuel)', () => {
    for (const preset of MAPPING_PRESETS) {
      const mapping = presetToMapping(preset, 'Daily Driver');
      const csv = PRESET_ROWS[preset.id];
      expect(csv, `add a sample row for preset ${preset.id}`).toBeDefined();

      // Convert into a miles/US-gal vehicle (matches the seeded demo vehicle's units).
      const native = applyMapping(csv, mapping, {
        distanceUnit: DistanceUnit.MILES,
        volumeUnit: VolumeUnit.GALLONS_US,
      });
      // applyMapping itself stamps the blank category cell with the preset default.
      const [, firstRow] = native.csv.split('\n');
      expect(firstRow.split(',')[2], `${preset.id} native category cell`).toBe('fuel');

      const plan = buildImportPlan(native.csv, vehicles);
      // FIXED behavior: the blank category is defaulted to fuel, so the row validates ready.
      expect(plan.readyCount, `${preset.id} ready count (post-defaultCategory fix)`).toBe(1);
      expect(plan.errorCount, `${preset.id} error count`).toBe(0);
      expect(plan.rows[0]?.expense?.category, `${preset.id} committed category`).toBe('fuel');
    }
  });

  test('defaultCategory fills ONLY a blank cell — a NAMED-but-unknown word still falls back to misc', () => {
    // A row that DOES carry a category column with an unrecognized word must NOT be silently coerced
    // to the default; it stays the misc fallback + is reported as unmapped (the C47/D2 path is intact).
    const mapping = presetToMapping(MAPPING_PRESETS[0], 'Daily Driver');
    mapping.columns = { ...mapping.columns, category: 'Cat' };
    const csv = [
      'Date,Odometer,Fill Amount,Price,Fuel Type,Notes,Cat',
      '03/01/2026,30000,9,36.00,Gas,x,Sparkplugs',
    ].join('\n');
    const { csv: native, unmappedCategories } = applyMapping(csv, mapping, {
      distanceUnit: DistanceUnit.MILES,
      volumeUnit: VolumeUnit.GALLONS_US,
    });
    expect(native.split('\n')[1].split(',')[2]).toBe('misc'); // NOT 'fuel'
    expect(unmappedCategories).toContain('Sparkplugs');
  });
});

// C151 DEEP-REVIEW (certify + guard): the C148 `defaultCategory` change composes safely with the import
// write-path invariants — verified firsthand, no defect. Two previously-untested intersections (the C148
// tests only covered fuel rows WITH complete volume+mileage):
//   (1) A blank-category row defaulted to `fuel` that LACKS volume/mileage must NOT slip through — parseRow's
//       fuel-completeness gate (import-csv.ts:252, mirroring the POST route) still fires → a clean per-row
//       error, readyCount 0, NO bad insert. The default fills the category cell; it does NOT bypass validation.
//   (2) `defaultCategory` is schema-typed as any ExpenseCategory. A NON-fuel default (e.g. 'maintenance') on a
//       row carrying a stray odometer/volume must have those fuel-only fields NULLED by clearImportedFuelFields
//       (#137/C448, the import mirror of clearFuelFieldsIfNotFuel) so it can't poison getCurrentOdometer's
//       cross-category MAX(odometer) — exactly as a named-non-fuel row does. The default doesn't create a
//       fuel-field-leak path. Pins both so a future change to defaultCategory handling can't silently regress
//       either (drop the line-252 gate → case 1 RED; drop clearImportedFuelFields → case 2 RED).
describe('defaultCategory × import write-path hygiene (C151 deep-review guard)', () => {
  const vehicles: ImportVehicle[] = [
    { id: 'veh-1', make: 'Honda', model: 'Civic', year: 2020, nickname: 'Daily Driver' },
  ];

  test('a defaulted-fuel row MISSING volume/mileage is a clean per-row error, not a bad insert', () => {
    // A detected fuel tracker with NO volume column mapped + a row with no fuel data: the default sets
    // category=fuel, but the fuel-completeness gate must still reject it (no silent partial fuel row).
    const { csv: native } = applyMapping(
      ['Date,Odometer,Price', '03/01/2026,30000,36.00'].join('\n'),
      {
        source: 'fuelly',
        columns: { date: 'Date', mileage: 'Odometer', amount: 'Price' }, // deliberately NO volume
        targetVehicle: 'Daily Driver',
        dateFormat: 'mdy',
        defaultCategory: 'fuel',
      },
      {}
    );
    expect(native.split('\n')[1].split(',')[2]).toBe('fuel'); // the blank cell WAS defaulted to fuel
    const plan = buildImportPlan(native, vehicles);
    expect(plan.readyCount).toBe(0);
    expect(plan.errorCount).toBe(1);
    expect(plan.rows[0]?.message).toMatch(/fuel/i); // "Fuel rows require fuel amount and mileage"
  });

  test('a NON-fuel defaultCategory still nulls a stray odometer/volume (no getCurrentOdometer poison)', () => {
    const { csv: native } = applyMapping(
      ['Date,Odometer,Volume,Price', '03/01/2026,99999,40,200.00'].join('\n'),
      {
        columns: { date: 'Date', mileage: 'Odometer', volume: 'Volume', amount: 'Price' },
        targetVehicle: 'Daily Driver',
        dateFormat: 'mdy',
        defaultCategory: 'maintenance',
      },
      {}
    );
    const plan = buildImportPlan(native, vehicles);
    const exp = plan.rows[0]?.expense;
    expect(plan.readyCount).toBe(1);
    expect(exp?.category).toBe('maintenance');
    expect(exp?.mileage).toBeNull(); // stray odometer NULLED (clearImportedFuelFields), not persisted
    expect(exp?.volume).toBeNull();
  });
});
