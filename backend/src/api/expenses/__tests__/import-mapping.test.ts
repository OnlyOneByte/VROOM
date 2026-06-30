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

  // C334 (bug-cycle dormant-vein scout outcome): mapMileage/mapVolume guard conversion on each
  // field's OWN `from && to` independently. The live caller (resolveTargetUnits) only ever returns
  // {} or BOTH units set, so today every row is all-converted or all-passed-through. But the
  // per-field guards mean a future change handing applyMapping a PARTIAL target (one unit resolved,
  // the other not — e.g. a vehicle missing one preference, or a refactor that resolves units
  // separately) would convert ONE axis and silently pass the other through in the SAME row — a
  // mixed converted/unconverted record (NORTH_STAR #2 unit-correctness). Pin the per-field
  // independence so that mixed-target behavior is explicit + a regression that coupled the two
  // guards (or dropped one) is caught. Distance converts, volume passes through verbatim, here.
  test('a PARTIAL target converts only the field whose target unit is present (per-field guard)', () => {
    const csv = ['odo,litres', '160.9344,37.854'].join('\n');
    const mapping: ColumnMapping = {
      columns: { mileage: 'odo', volume: 'litres' },
      dateFormat: 'iso',
      distanceUnit: DistanceUnit.KILOMETERS,
      volumeUnit: VolumeUnit.LITERS,
    };
    // Only distanceUnit resolved on the target; volumeUnit absent.
    const [row] = parseNative(applyMapping(csv, mapping, { distanceUnit: DistanceUnit.MILES }).csv);
    expect(row.mileage).toBe('100'); // 160.9344 km → 100 mi (distance target present → converts)
    expect(row.volume).toBe('37.854'); // volume target absent → passes through, NOT converted to gal
  });

  test('the mirror partial: volume target present, distance absent → only volume converts', () => {
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
    expect(row.mileage).toBe('161'); // distance target absent → passes through (160.9344 rounded), NOT km→mi (100)
    expect(Number(row.volume)).toBeCloseTo(10, 2); // volume target present → 37.854 L → ~10 US gal
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

  // #124 (C417): a US-format value with BOTH separators (comma thousands + dot decimal) is reachable via
  // the US Fuelly preset (mdy/miles/US-gallons). The old code hard-assumed comma-decimal → stripped the
  // dots → "1,234.56" became 1.23456 (~1000x money under-count). The fix keys on the LAST separator as
  // the decimal, so BOTH conventions normalize correctly. Pre-fix this asserted ~1.23 (RED).
  test('US-format dot-decimal + comma-thousands also normalizes correctly (1,234.56 → 1234.56)', () => {
    const csv = ['amt', '"1,234.56"'].join('\n');
    const mapping: ColumnMapping = { columns: { amount: 'amt' }, dateFormat: 'iso' };
    const [row] = parseNative(applyMapping(csv, mapping).csv);
    expect(row.amount).toBe('1234.56'); // comma thousands stripped, dot stays decimal — NOT 1.23456
    expect(Number(row.amount)).toBeCloseTo(1234.56, 2);
  });

  test('a multi-group US number with both separators (1,234,567.89) normalizes', () => {
    const csv = ['amt', '"1,234,567.89"'].join('\n');
    const mapping: ColumnMapping = { columns: { amount: 'amt' }, dateFormat: 'iso' };
    const [row] = parseNative(applyMapping(csv, mapping).csv);
    expect(Number(row.amount)).toBeCloseTo(1234567.89, 2);
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

describe('normalizeForeignDate — out-of-range parts do NOT silently roll over (C115, bug #23)', () => {
  // JS `new Date(2024, 44, 13)` is a VALID Date ~3.7yr later, and `new Date(2024, 1, 30)` (Feb 30)
  // rolls to March — so before the echo-check these stored a wrong date with no error. The contract:
  // an out-of-range/impossible date returns the RAW string so buildImportPlan's parseDate errors the
  // row (the deferred-error contract), never a silently-rolled-over wrong date.
  test('an out-of-range month/day is returned raw, not rolled forward', () => {
    expect(normalizeForeignDate('13/45/2024', 'dmy')).toBe('13/45/2024'); // day 13, month 45
    expect(normalizeForeignDate('25/03/2024', 'mdy')).toBe('25/03/2024'); // month 25 (wrong format pick)
  });

  test('an impossible calendar day (Feb 30) is returned raw, not rolled into March', () => {
    expect(normalizeForeignDate('02/30/2024', 'mdy')).toBe('02/30/2024');
  });

  test('an empty date segment is returned raw, not coerced to a rolled-over date', () => {
    // "2024--15" → [2024, 0, 15]: Number('')===0 is an integer, so the old guard passed it →
    // new Date(2024, -1, 15) = Dec 2023. The echo-check (month 0 ≠ -1) now rejects it.
    expect(normalizeForeignDate('2024--15', 'iso')).toBe('2024--15');
  });

  test('a valid in-range date still normalizes (the guard does not over-reject)', () => {
    // Regression guard: the fix must not break the happy path — a real date still round-trips to
    // the intended local calendar day (not the raw string).
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
    expect(exp.expenseAmount).toBe(5240); // "52,40" comma-decimal → $52.40 → 5240 cents (money-cents-migration)
    expect(exp.mileage).toBe(100); // 160.9344 km → 100 mi
    expect(exp.volume).toBeCloseTo(10, 2); // 37.854 L → ~10 US gal
    expect(exp.date.getFullYear()).toBe(2024); // dmy parsed, local day kept
    expect(exp.date.getMonth() + 1).toBe(3);
    expect(exp.date.getDate()).toBe(15);
  });
});

// ── C60 deep-review: characterization guards for two verified-but-uncovered branches.
// The C58 audit confirmed these behave correctly; pin them so a future edit can't
// silently regress (NORTH_STAR quality-bar #5).

describe('normalizeForeignDate — an ISO value with an explicit timezone is an absolute instant', () => {
  test('a Z-suffixed ISO timestamp is honored as-is (NOT re-interpreted in local time)', () => {
    // This is the one branch that must NOT use local-time construction: the value already
    // names an absolute instant, so it round-trips through Date unchanged regardless of the
    // runner's zone. (A date-ONLY iso value still takes the local-time path — covered above.)
    const iso = '2024-03-15T08:30:00.000Z';
    expect(normalizeForeignDate(iso, 'iso')).toBe(new Date(iso).toISOString());
  });

  test('an explicit +hh:mm offset is preserved as the same instant', () => {
    // 2024-03-15T00:00+02:00 is 2024-03-14T22:00Z — the offset must be respected, not dropped.
    expect(normalizeForeignDate('2024-03-15T00:00:00+02:00', 'iso')).toBe(
      new Date('2024-03-15T00:00:00+02:00').toISOString()
    );
  });
});

describe('applyMapping — a non-finite mapped value is passed through for buildImportPlan to error', () => {
  // mapVolume/mapMileage deliberately DON'T throw on garbage: they hand the raw value
  // downstream so it surfaces as a normal per-row error (not a whole-file crash). This pins
  // that contract end-to-end through the real buildImportPlan.
  test('a non-numeric volume/mileage becomes a per-row error, not a thrown exception', () => {
    const vehicles: ImportVehicle[] = [
      { id: 'veh-1', make: 'Honda', model: 'Civic', year: 2020, nickname: 'Daily Driver' },
    ];
    const csv = [
      'Date,Odo,Vol,Price,Type',
      '2024-03-15,not-a-number,abc,42.00,fuel', // garbage odo + volume
    ].join('\n');
    const mapping: ColumnMapping = {
      columns: { date: 'Date', mileage: 'Odo', volume: 'Vol', amount: 'Price', category: 'Type' },
      targetVehicle: 'Daily Driver',
      dateFormat: 'iso',
      distanceUnit: DistanceUnit.MILES,
      volumeUnit: VolumeUnit.GALLONS_US,
    };
    // applyMapping itself does not throw — the garbage passes through verbatim.
    const native = applyMapping(csv, mapping, {
      distanceUnit: DistanceUnit.MILES,
      volumeUnit: VolumeUnit.GALLONS_US,
    });
    const plan = buildImportPlan(native.csv, vehicles);
    // buildImportPlan reports it as a normal per-row error (fuel row needs valid volume+mileage).
    expect(plan.readyCount).toBe(0);
    expect(plan.errorCount).toBe(1);
    expect(plan.rows[0].status).toBe('error');
  });
});
