/**
 * Fuelio import adapter guard (data-migration spec). Drives the PURE `parseFuelioExport` against a
 * realistic multi-section Fuelio backup (a `## Vehicle` / `## Log` / `## CostCategories` / `## Costs`
 * file in km/litres, imported into a miles/US-gallons target so unit conversion is exercised), then
 * feeds the emitted native CSV through the REAL `buildImportPlan` to prove the end-to-end contract:
 * every downstream guarantee (per-row validation, vehicle resolution, cents conversion, idempotency)
 * is inherited. Pins the four things a naive Fuelio importer gets wrong: multi-section splitting,
 * header-embedded units, `Missed`→missedFillup, and migrating the non-fuel `## Costs` section.
 */

import { describe, expect, test } from 'bun:test';
import { DistanceUnit, VolumeUnit } from '../../../types';
import { convertDistance, convertVolume } from '../../../utils/unit-conversions';
import { isFuelioExport, parseFuelioExport } from '../fuelio-import';
import { buildImportPlan, type ImportVehicle } from '../import-csv';

// A realistic Fuelio export: metric (km / litres), two fuel rows (one full, one partial+Missed),
// and two costs (Service → maintenance; Ferry → unmapped → misc).
const FUELIO_CSV = `"## Vehicle"
"Name","Description","DistUnit","FuelUnit","ConsumptionUnit","ImportCSVDateFormat","VIN","Insurance","Plate","Make","Model","Year","TankCount","Tank1Type","Tank2Type"
"Golf","Daily driver","0","0","2","yyyy-MM-dd","","","ABC-123","Volkswagen","Golf","2018","1","0","0"

"## Log"
"Data","Odo (km)","Fuel (litres)","Full","Price (optional)","mpg (optional)","latitude (optional)","longitude (optional)","City (optional)","Notes (optional)","Missed","TankNumber","FuelType","VolumePrice","StationID (optional)"
"2024-01-05","45210","42.10","1","68.90",,,,,"first fill",0,"1","0","1.636",
"2024-01-19","45620","20.00","0","32.80",,,,,"partial top-up",1,"1","0","1.640",

"## CostCategories"
"CostTypeID","Name","priority","color"
"1","Service","0","#795548"
"9","Ferry","0","#9E9E9E"

"## Costs"
"CostTitle","Date","Odo","CostTypeID","Notes","Cost","flag","idR","read","RemindOdo","RemindDate","isTemplate","RepeatOdo","RepeatMonths"
"Oil change","2024-01-10","45300","1","5W-30","89.00","0","0","1","0","2011-01-01","0","0","0"
"Ferry ticket","2024-02-01","46000","9","","25.00","0","0","1","0","2011-01-01","0","0","0"
`;

const TARGET_VEHICLE = '2018 Volkswagen Golf';
const TARGET_UNITS = { distanceUnit: DistanceUnit.MILES, volumeUnit: VolumeUnit.GALLONS_US };
const VEHICLES: ImportVehicle[] = [
  { id: 'veh-1', make: 'Volkswagen', model: 'Golf', year: 2018, nickname: null },
];

describe('isFuelioExport', () => {
  test('recognizes a Fuelio multi-section export', () => {
    expect(isFuelioExport(FUELIO_CSV)).toBe(true);
  });
  test('rejects a plain CSV', () => {
    expect(isFuelioExport('date,vehicle,amount\n2024-01-01,Golf,10')).toBe(false);
  });
});

describe('parseFuelioExport', () => {
  test('detects the vehicle name and the file units from the headers', () => {
    const r = parseFuelioExport(FUELIO_CSV, {
      targetVehicle: TARGET_VEHICLE,
      targetUnits: TARGET_UNITS,
    });
    expect(r.fileVehicleName).toBe('Golf');
    expect(r.fileDistanceUnit).toBe(DistanceUnit.KILOMETERS);
    expect(r.fileVolumeUnit).toBe(VolumeUnit.LITERS);
    expect(r.logCount).toBe(2);
    expect(r.costCount).toBe(2);
    expect(r.unmappedCategories).toEqual(['Ferry']); // Service maps → maintenance; Ferry falls to misc
  });

  test('throws on a non-Fuelio file', () => {
    expect(() => parseFuelioExport('a,b\n1,2', { targetVehicle: 'x', targetUnits: {} })).toThrow(
      /Fuelio/
    );
  });

  test('is deterministic (same input → identical CSV, so re-import dedups)', () => {
    const a = parseFuelioExport(FUELIO_CSV, {
      targetVehicle: TARGET_VEHICLE,
      targetUnits: TARGET_UNITS,
    });
    const b = parseFuelioExport(FUELIO_CSV, {
      targetVehicle: TARGET_VEHICLE,
      targetUnits: TARGET_UNITS,
    });
    expect(a.csv).toBe(b.csv);
  });

  test('omitting costs migrates only the fuel log', () => {
    const r = parseFuelioExport(FUELIO_CSV, {
      targetVehicle: TARGET_VEHICLE,
      targetUnits: TARGET_UNITS,
      includeCosts: false,
    });
    expect(r.logCount).toBe(2);
    expect(r.costCount).toBe(0);
  });
});

describe('Fuelio → native CSV → buildImportPlan (end-to-end)', () => {
  const { csv } = parseFuelioExport(FUELIO_CSV, {
    targetVehicle: TARGET_VEHICLE,
    targetUnits: TARGET_UNITS,
  });
  const plan = buildImportPlan(csv, VEHICLES);

  test('every row is ready (fuel + costs), attached to the owned vehicle', () => {
    expect(plan.errorCount).toBe(0);
    expect(plan.readyCount).toBe(4);
    for (const row of plan.rows) expect(row.expense?.vehicleId).toBe('veh-1');
  });

  test('fuel rows: km→mi + litres→gal conversion, cents amount, Missed→missedFillup', () => {
    const fuel = plan.rows.map((r) => r.expense).filter((e) => e?.category === 'fuel');
    expect(fuel).toHaveLength(2);

    const full = fuel[0]!; // 2024-01-05, Missed=0
    expect(full.expenseAmount).toBe(6890); // $68.90 → cents
    expect(full.mileage).toBe(
      Math.round(convertDistance(45210, DistanceUnit.KILOMETERS, DistanceUnit.MILES))
    );
    expect(full.volume).toBeCloseTo(
      convertVolume(42.1, VolumeUnit.LITERS, VolumeUnit.GALLONS_US),
      2
    );
    expect(full.missedFillup).toBe(false);

    const partial = fuel[1]!; // 2024-01-19, Missed=1
    expect(partial.expenseAmount).toBe(3280);
    expect(partial.missedFillup).toBe(true);
  });

  test('cost rows: category-mapped, cents amount, no fuel fields leaked', () => {
    const costs = plan.rows.map((r) => r.expense).filter((e) => e && e.category !== 'fuel');
    expect(costs).toHaveLength(2);

    const service = costs.find((e) => e?.description?.includes('Oil change'))!;
    expect(service.category).toBe('maintenance'); // Fuelio "Service" → maintenance
    expect(service.expenseAmount).toBe(8900);
    expect(service.mileage).toBeNull(); // non-fuel row must not carry an odometer (#137)
    expect(service.volume).toBeNull();

    const ferry = costs.find((e) => e?.description?.includes('Ferry'))!;
    expect(ferry.category).toBe('misc'); // unmapped Fuelio category → misc
    expect(ferry.expenseAmount).toBe(2500);
  });
});

describe('cost categories that resolve to no name are still surfaced (never a silent misc)', () => {
  // A cost row whose CostTypeID is absent from ## CostCategories. Fuelio users delete categories,
  // which orphans the id on rows that referenced it.
  const ORPHAN_ID_CSV = `"## Vehicle"
"Name","DistUnit","FuelUnit","ImportCSVDateFormat"
"Golf","0","0","yyyy-MM-dd"

"## Log"
"Data","Odo (km)","Fuel (litres)","Price","Missed"
"2024-01-05","45210","42.10","68.90",0

"## CostCategories"
"CostTypeID","Name","priority","color"
"1","Service","0","#795548"

"## Costs"
"CostTitle","Date","Odo","CostTypeID","Notes","Cost"
"Mystery charge","2024-02-01","46000","99","","25.00"
`;

  // A partial export: costs reference ids, but the CostCategories section is missing entirely.
  const NO_CATEGORIES_CSV = ORPHAN_ID_CSV.replace(
    /"## CostCategories"\n"CostTypeID","Name","priority","color"\n"1","Service","0","#795548"\n\n/,
    ''
  );

  test('an orphaned CostTypeID lands in misc AND is reported by id', () => {
    const r = parseFuelioExport(ORPHAN_ID_CSV, {
      targetVehicle: TARGET_VEHICLE,
      targetUnits: TARGET_UNITS,
    });
    expect(r.costCount).toBe(1);
    // The whole point: the user is told the row was bucketed, naming the id we could not resolve.
    expect(r.unmappedCategories).toEqual(['Unknown category 99']);

    const plan = buildImportPlan(r.csv, VEHICLES);
    const cost = plan.rows.find((row) => row.expense?.description === 'Mystery charge');
    expect(cost?.status).toBe('ready');
    expect(cost?.expense?.category).toBe('misc');
  });

  test('a Costs section with no CostCategories section surfaces every id', () => {
    const r = parseFuelioExport(NO_CATEGORIES_CSV, {
      targetVehicle: TARGET_VEHICLE,
      targetUnits: TARGET_UNITS,
    });
    expect(r.costCount).toBe(1);
    expect(r.unmappedCategories).toEqual(['Unknown category 99']);
  });

  test('a named-but-unmapped category is still reported by NAME, not by id', () => {
    const r = parseFuelioExport(FUELIO_CSV, {
      targetVehicle: TARGET_VEHICLE,
      targetUnits: TARGET_UNITS,
    });
    expect(r.unmappedCategories).toEqual(['Ferry']);
  });
});
