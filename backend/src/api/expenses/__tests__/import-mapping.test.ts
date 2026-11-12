import { describe, expect, test } from 'bun:test';
import { DistanceUnit, VolumeUnit } from '../../../types';
import { buildImportPlan, type ImportVehicle } from '../import-csv';
import {
  applyMapping,
  type ColumnMapping,
  CsvMappingError,
  normalizeForeignDate,
} from '../import-mapping';

function parseNative(csv: string): Record<string, string>[] {
  const [header, ...lines] = csv.split('\n');
  const cols = header.split(',');
  return lines.map((line) => {
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

describe('applyMapping — unit conversion into the target vehicle units', () => {
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
    expect(row.mileage).toBe('100');
    expect(Number(row.volume)).toBeCloseTo(10, 2);
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

  test('a partial target converts only the field whose target unit is present', () => {
    const csv = ['odo,litres', '160.9344,37.854'].join('\n');
    const mapping: ColumnMapping = {
      columns: { mileage: 'odo', volume: 'litres' },
      dateFormat: 'iso',
      distanceUnit: DistanceUnit.KILOMETERS,
      volumeUnit: VolumeUnit.LITERS,
    };
    const [row] = parseNative(applyMapping(csv, mapping, { distanceUnit: DistanceUnit.MILES }).csv);
    expect(row.mileage).toBe('100');
    expect(row.volume).toBe('37.854');
  });

  test('volume target present and distance absent converts only volume', () => {
    const csv = ['odo,litres', '160.9344,37.854'].join('\n');
    const mapping: ColumnMapping = {
      columns: { mileage: 'odo', volume: 'litres' },
      dateFormat: 'iso',
      distanceUnit: DistanceUnit.KILOMETERS,
      volumeUnit: VolumeUnit.LITERS,
    };
    const [row] = parseNative(
      applyMapping(csv, mapping, { volumeUnit: VolumeUnit.GALLONS_US }).csv
    );
    expect(row.mileage).toBe('161');
    expect(Number(row.volume)).toBeCloseTo(10, 2);
  });
});

describe('applyMapping — European decimal-comma', () => {
  test('comma decimal and dot-thousands+comma-decimal both normalize to a dot', () => {
    const csv = ['amt,vol', '"1.234,56","45,7"'].join('\n');
    const mapping: ColumnMapping = {
      columns: { amount: 'amt', volume: 'vol' },
      dateFormat: 'iso',
    };
    const [row] = parseNative(applyMapping(csv, mapping).csv);
    expect(row.amount).toBe('1234.56');
    expect(Number(row.volume)).toBeCloseTo(45.7, 3);
  });

  test('US-format dot-decimal + comma-thousands also normalizes correctly (1,234.56 → 1234.56)', () => {
    const csv = ['amt', '"1,234.56"'].join('\n');
    const mapping: ColumnMapping = { columns: { amount: 'amt' }, dateFormat: 'iso' };
    const [row] = parseNative(applyMapping(csv, mapping).csv);
    expect(row.amount).toBe('1234.56');
    expect(Number(row.amount)).toBeCloseTo(1234.56, 2);
  });

  test('a multi-group US number with both separators (1,234,567.89) normalizes', () => {
    const csv = ['amt', '"1,234,567.89"'].join('\n');
    const mapping: ColumnMapping = { columns: { amount: 'amt' }, dateFormat: 'iso' };
    const [row] = parseNative(applyMapping(csv, mapping).csv);
    expect(Number(row.amount)).toBeCloseTo(1234567.89, 2);
  });
});

describe('applyMapping — category map and unmapped words to misc', () => {
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
    expect(result.unmappedCategories).toEqual(['Parking']);
  });

  test('a native category word passes through even without a categoryMap entry', () => {
    const csv = ['cat', 'maintenance'].join('\n');
    const result = applyMapping(csv, { columns: { category: 'cat' }, dateFormat: 'iso' });
    expect(parseNative(result.csv)[0].category).toBe('maintenance');
    expect(result.unmappedCategories).toEqual([]);
  });
});

describe('applyMapping — no vehicle column injects targetVehicle', () => {
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

describe('normalizeForeignDate — local-time handling across formats', () => {
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

describe('normalizeForeignDate — out-of-range parts do NOT silently roll over', () => {
  test('an out-of-range month/day is returned raw, not rolled forward', () => {
    expect(normalizeForeignDate('13/45/2024', 'dmy')).toBe('13/45/2024');
    expect(normalizeForeignDate('25/03/2024', 'mdy')).toBe('25/03/2024');
  });

  test('an impossible calendar day (Feb 30) is returned raw, not rolled into March', () => {
    expect(normalizeForeignDate('02/30/2024', 'mdy')).toBe('02/30/2024');
  });

  test('an empty date segment is returned raw, not coerced to a rolled-over date', () => {
    expect(normalizeForeignDate('2024--15', 'iso')).toBe('2024--15');
  });

  test('a valid in-range date still normalizes (the guard does not over-reject)', () => {
    const d = new Date(normalizeForeignDate('12/31/2024', 'mdy'));
    expect({ y: d.getFullYear(), m: d.getMonth() + 1, day: d.getDate() }).toEqual({
      y: 2024,
      m: 12,
      day: 31,
    });
  });
});

describe('applyMapping — whole-file errors', () => {
  test('throws CsvMappingError on an unparseable file', () => {
    expect(() => applyMapping('a,b\n"unterminated,1', { columns: {}, dateFormat: 'iso' })).toThrow(
      CsvMappingError
    );
  });
});

describe('applyMapping output imports through buildImportPlan', () => {
  test('a Fuelio-shaped metric file maps + converts into a native plan that imports cleanly', () => {
    const vehicles: ImportVehicle[] = [
      { id: 'veh-1', make: 'Honda', model: 'Civic', year: 2020, nickname: 'Daily Driver' },
    ];
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
    expect(exp.vehicleId).toBe('veh-1');
    expect(exp.category).toBe('fuel');
    expect(exp.expenseAmount).toBe(5240);
    expect(exp.mileage).toBe(100);
    expect(exp.volume).toBeCloseTo(10, 2);
    expect(exp.date.getFullYear()).toBe(2024);
    expect(exp.date.getMonth() + 1).toBe(3);
    expect(exp.date.getDate()).toBe(15);
  });
});

describe('normalizeForeignDate — an ISO value with an explicit timezone is an absolute instant', () => {
  test('a Z-suffixed ISO timestamp is honored as-is (NOT re-interpreted in local time)', () => {
    const iso = '2024-03-15T08:30:00.000Z';
    expect(normalizeForeignDate(iso, 'iso')).toBe(new Date(iso).toISOString());
  });

  test('an explicit +hh:mm offset is preserved as the same instant', () => {
    expect(normalizeForeignDate('2024-03-15T00:00:00+02:00', 'iso')).toBe(
      new Date('2024-03-15T00:00:00+02:00').toISOString()
    );
  });
});

describe('applyMapping — a non-finite mapped value is passed through for buildImportPlan to error', () => {
  test('a non-numeric volume/mileage becomes a per-row error, not a thrown exception', () => {
    const vehicles: ImportVehicle[] = [
      { id: 'veh-1', make: 'Honda', model: 'Civic', year: 2020, nickname: 'Daily Driver' },
    ];
    const csv = ['Date,Odo,Vol,Price,Type', '2024-03-15,not-a-number,abc,42.00,fuel'].join('\n');
    const mapping: ColumnMapping = {
      columns: { date: 'Date', mileage: 'Odo', volume: 'Vol', amount: 'Price', category: 'Type' },
      targetVehicle: 'Daily Driver',
      dateFormat: 'iso',
      distanceUnit: DistanceUnit.MILES,
      volumeUnit: VolumeUnit.GALLONS_US,
    };
    const native = applyMapping(csv, mapping, {
      distanceUnit: DistanceUnit.MILES,
      volumeUnit: VolumeUnit.GALLONS_US,
    });
    const plan = buildImportPlan(native.csv, vehicles);
    expect(plan.readyCount).toBe(0);
    expect(plan.errorCount).toBe(1);
    expect(plan.rows[0].status).toBe('error');
  });
});
