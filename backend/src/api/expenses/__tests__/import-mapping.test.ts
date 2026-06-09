/**
 * Unit tests for the import-from-other-trackers translation pre-pass
 * (`import-mapping.ts`, spec T1). `applyMapping` is pure, so these stand up no
 * server: they pin column rename, unit conversion into the target's units,
 * decimal-comma, the category map (+ unmapped→misc flag), each date format, and
 * the no-vehicle-column → targetVehicle injection. The load-bearing case feeds the
 * output straight into the REAL `buildImportPlan` to prove the native shape it emits
 * is actually consumable end-to-end (the whole reason the pre-pass design works).
 */

import { describe, expect, test } from 'bun:test';
import { DistanceUnit, VolumeUnit } from '../../../types';
import { buildImportPlan, type ImportVehicle } from '../import-csv';
import {
  applyMapping,
  type ColumnMapping,
  CsvMappingError,
  normalizeForeignDate,
} from '../import-mapping';

/** Parse the native CSV `applyMapping` emits back into header→value record rows. */
function parseNative(csv: string): Record<string, string>[] {
  const [header, ...lines] = csv.split('\n');
  const cols = header.split(',');
  return lines.map((line) => {
    // Test fixtures here never quote cells, so a plain split is faithful.
    const cells = line.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? '']));
  });
}

describe('applyMapping — column rename', () => {
  test('renames foreign headers onto the native shape', () => {
    const csv = ['When,Car,Kind,Cost', '2024-03-15,Civic,fuel,42.10'].join('\n');
    const mapping: ColumnMapping = {
      columns: { date: 'When', vehicle: 'Car', category: 'Kind', amount: 'Cost' },
      dateFormat: 'iso',
    };
    const [row] = parseNative(applyMapping(csv, mapping).csv);
    expect(row.vehicle).toBe('Civic');
    expect(row.category).toBe('fuel');
    expect(row.amount).toBe('42.10');
  });
});

describe('applyMapping — unit conversion into the target vehicle units (D1)', () => {
  test('km file into a miles vehicle converts distance; liters into US gallons converts volume', () => {
    const csv = ['odo,litres', '160.9344,37.854'].join('\n');
    const mapping: ColumnMapping = {
      columns: { mileage: 'odo', volume: 'litres' },
      dateFormat: 'iso',
      distanceUnit: DistanceUnit.KILOMETERS,
      volumeUnit: VolumeUnit.LITERS,
    };
    const [row] = parseNative(
      applyMapping(csv, mapping, {
        distanceUnit: DistanceUnit.MILES,
        volumeUnit: VolumeUnit.GALLONS_US,
      }).csv
    );
    expect(row.mileage).toBe('100'); // 160.9344 km → 100 mi, rounded to integer
    expect(Number(row.volume)).toBeCloseTo(10, 2); // 37.854 L → ~10 US gal
  });

  test('values pass through unchanged when target units are omitted (no conversion)', () => {
    const csv = ['odo,vol', '50000,12.5'].join('\n');
    const mapping: ColumnMapping = {
      columns: { mileage: 'odo', volume: 'vol' },
      dateFormat: 'iso',
      distanceUnit: DistanceUnit.MILES,
      volumeUnit: VolumeUnit.GALLONS_US,
    };
    const [row] = parseNative(applyMapping(csv, mapping).csv);
    expect(row.mileage).toBe('50000');
    expect(row.volume).toBe('12.5');
  });
});

describe('applyMapping — European decimal-comma (D1)', () => {
  test('comma decimal and dot-thousands+comma-decimal both normalize to a dot', () => {
    // A real comma-decimal file QUOTES the cells (comma is the decimal separator, so the
    // column delimiter can't also be a bare comma) — that's the faithful fixture here.
    const csv = ['amt,vol', '"1.234,56","45,7"'].join('\n');
    const mapping: ColumnMapping = {
      columns: { amount: 'amt', volume: 'vol' },
      dateFormat: 'iso',
    };
    const [row] = parseNative(applyMapping(csv, mapping).csv);
    expect(row.amount).toBe('1234.56'); // dot thousands stripped, comma → dot
    expect(Number(row.volume)).toBeCloseTo(45.7, 3); // lone comma → decimal dot
  });
});

describe('applyMapping — category map + unmapped→misc (D2)', () => {
  test('maps foreign words, buckets the unrecognized to misc, and reports them', () => {
    const csv = ['cat', 'Gas', 'Service', 'Parking', 'fuel'].join('\n');
    const mapping: ColumnMapping = {
      columns: { category: 'cat' },
      dateFormat: 'iso',
      categoryMap: { gas: 'fuel', service: 'maintenance' },
    };
    const result = applyMapping(csv, mapping);
    const rows = parseNative(result.csv);
    expect(rows.map((r) => r.category)).toEqual(['fuel', 'maintenance', 'misc', 'fuel']);
    // 'Parking' had no mapping → misc + a visible note; native words ('fuel') don't flag.
    expect(result.unmappedCategories).toEqual(['Parking']);
  });

  test('a native category word passes through even without a categoryMap entry', () => {
    const csv = ['cat', 'maintenance'].join('\n');
    const result = applyMapping(csv, { columns: { category: 'cat' }, dateFormat: 'iso' });
    expect(parseNative(result.csv)[0].category).toBe('maintenance');
    expect(result.unmappedCategories).toEqual([]);
  });
});

describe('applyMapping — no vehicle column → targetVehicle injection (D4)', () => {
  test('stamps the chosen target vehicle on every row when the file has no vehicle column', () => {
    const csv = ['date,amt', '2024-01-02,10', '2024-01-03,20'].join('\n');
    const mapping: ColumnMapping = {
      columns: { date: 'date', amount: 'amt' },
      targetVehicle: 'Daily Driver',
      dateFormat: 'iso',
    };
    const rows = parseNative(applyMapping(csv, mapping).csv);
    expect(rows.every((r) => r.vehicle === 'Daily Driver')).toBe(true);
  });
});

describe('normalizeForeignDate — local-time discipline across formats (D3)', () => {
  // The invariant (cycle-6/11): a date-only value must keep the user's intended
  // CALENDAR DAY regardless of the runner's timezone. We assert that property —
  // normalize → parse back → local Y/M/D matches — so it holds in any CI zone.
  function localParts(iso: string) {
    const d = new Date(iso);
    return { y: d.getFullYear(), m: d.getMonth() + 1, day: d.getDate() };
  }

  test('iso (no timezone) preserves the calendar day', () => {
    expect(localParts(normalizeForeignDate('2024-03-15', 'iso'))).toEqual({
      y: 2024,
      m: 3,
      day: 15,
    });
  });

  test('mdy and dmy resolve the same calendar day from a swapped order', () => {
    expect(localParts(normalizeForeignDate('03/15/2024', 'mdy'))).toEqual({
      y: 2024,
      m: 3,
      day: 15,
    });
    expect(localParts(normalizeForeignDate('15/03/2024', 'dmy'))).toEqual({
      y: 2024,
      m: 3,
      day: 15,
    });
  });

  test('epoch seconds and millis both resolve to the same instant', () => {
    const secs = normalizeForeignDate('1710460800', 'epoch');
    const millis = normalizeForeignDate('1710460800000', 'epoch');
    expect(new Date(secs).getTime()).toBe(new Date(millis).getTime());
  });

  test('a 2-digit year is lifted into the 2000s', () => {
    expect(localParts(normalizeForeignDate('03/15/24', 'mdy')).y).toBe(2024);
  });

  test('an unparseable value is returned unchanged (buildImportPlan reports it, not us)', () => {
    expect(normalizeForeignDate('not-a-date', 'iso')).toBe('not-a-date');
    expect(normalizeForeignDate('', 'mdy')).toBe('');
  });
});

describe('applyMapping — whole-file errors', () => {
  test('throws CsvMappingError on an unparseable file', () => {
    // An unterminated quote is a hard parse error.
    expect(() => applyMapping('a,b\n"unterminated,1', { columns: {}, dateFormat: 'iso' })).toThrow(
      CsvMappingError
    );
  });
});

describe('applyMapping → buildImportPlan round-trip (the consumable-output proof)', () => {
  test('a Fuelio-shaped metric file maps + converts into a native plan that imports cleanly', () => {
    const vehicles: ImportVehicle[] = [
      { id: 'veh-1', make: 'Honda', model: 'Civic', year: 2020, nickname: 'Daily Driver' },
    ];
    // Foreign file: km odometer, litres, comma decimals, dmy dates, no vehicle column.
    const csv = [
      'Date,Odometer (km),Fuel (litres),Price,Type',
      '15/03/2024,160.9344,37.854,"52,40",Gas',
    ].join('\n');
    const mapping: ColumnMapping = {
      source: 'fuelio',
      columns: {
        date: 'Date',
        mileage: 'Odometer (km)',
        volume: 'Fuel (litres)',
        amount: 'Price',
        category: 'Type',
      },
      targetVehicle: 'Daily Driver',
      dateFormat: 'dmy',
      distanceUnit: DistanceUnit.KILOMETERS,
      volumeUnit: VolumeUnit.LITERS,
      categoryMap: { gas: 'fuel' },
    };

    const native = applyMapping(csv, mapping, {
      distanceUnit: DistanceUnit.MILES,
      volumeUnit: VolumeUnit.GALLONS_US,
    });
    const plan = buildImportPlan(native.csv, vehicles);

    expect(plan.errorCount).toBe(0);
    expect(plan.readyCount).toBe(1);
    const exp = plan.rows[0].expense;
    if (!exp) throw new Error('expected a ready row with a resolved expense');
    expect(exp.vehicleId).toBe('veh-1'); // targetVehicle resolved within the user's garage
    expect(exp.category).toBe('fuel'); // 'Gas' → fuel via categoryMap
    expect(exp.expenseAmount).toBeCloseTo(52.4, 2); // comma decimal normalized
    expect(exp.mileage).toBe(100); // 160.9344 km → 100 mi
    expect(exp.volume).toBeCloseTo(10, 2); // 37.854 L → ~10 US gal
    expect(exp.date.getFullYear()).toBe(2024); // dmy parsed, local day kept
    expect(exp.date.getMonth() + 1).toBe(3);
    expect(exp.date.getDate()).toBe(15);
  });
});
