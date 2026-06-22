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

// C32 CHARACTERIZATION (the C31 eyes-on finding, flagged to Angelo): the built-in fuel-log presets map
// NO category column (Fuelly/Fuelio/Drivvo refuel exports have no category field — they're definitionally
// all fuel). applyMapping emits a BLANK category cell, and mapCategory deliberately leaves a blank blank
// (the D2 "never invent a category" rule), so buildImportPlan errors EVERY row "Unknown category" →
// readyCount 0. Net: a perfectly-detected fuel log imports NOTHING today. These tests PIN that current
// behavior so the recommended fix (give each fuel preset a defaultCategory:'fuel') is a deliberate,
// net-flipping change — when it lands, the `category` expectation flips to 'fuel' and readyCount to N,
// and these tests are the ones to update. (Distinct from the round-trip test in import-mapping.test.ts,
// which hand-adds a category column to the mapping and so never exercises the REAL presets' gap.)
describe('MAPPING_PRESETS — category-column gap (C31 finding, characterization)', () => {
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

  test('NONE of the presets map a category column (the root of the gap)', () => {
    for (const preset of MAPPING_PRESETS) {
      expect(
        preset.columns.category,
        `${preset.id} should have no category column today`
      ).toBeUndefined();
    }
  });

  test('every preset currently yields 0 ready rows — "Unknown category" (pins the gap end-to-end)', () => {
    for (const preset of MAPPING_PRESETS) {
      const mapping = presetToMapping(preset, 'Daily Driver');
      const csv = PRESET_ROWS[preset.id];
      expect(csv, `add a sample row for preset ${preset.id}`).toBeDefined();

      // Convert into a miles/US-gal vehicle (matches the seeded demo vehicle's units).
      const native = applyMapping(csv, mapping, {
        distanceUnit: DistanceUnit.MILES,
        volumeUnit: VolumeUnit.GALLONS_US,
      });
      const plan = buildImportPlan(native.csv, vehicles);

      // CURRENT behavior: the row maps + the vehicle resolves, but the blank category fails validation.
      expect(plan.readyCount, `${preset.id} ready count (pre-defaultCategory fix)`).toBe(0);
      expect(plan.errorCount, `${preset.id} error count`).toBe(1);
      expect(plan.rows[0]?.message, `${preset.id} error message`).toMatch(/category/i);
    }
  });
});
