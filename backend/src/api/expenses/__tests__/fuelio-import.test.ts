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
  // The negative case is covered through the public API by 'throws on a non-Fuelio file' below —
  // isFuelioExport is that guard's only caller, so asserting it twice pins one branch twice.
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

/** A minimal Fuelio file whose Log header carries the given odometer/fuel column names. */
function fileWithLogHeaders(odoHeader: string, fuelHeader: string, odo = '45210', fuel = '42.10') {
  return `"## Vehicle"
"Name","ImportCSVDateFormat"
"Golf","yyyy-MM-dd"

"## Log"
"Data","${odoHeader}","${fuelHeader}","Price","Missed"
"2024-01-05","${odo}","${fuel}","68.90",0
`;
}

describe('unit detection from the ## Log header', () => {
  // Only the metric pair was exercised before, leaving every imperial branch unguarded in an app
  // whose default is miles. Driven through parseFuelioExport (which reports the detected units)
  // rather than by exporting the detectors.
  const CASES: [string, string, DistanceUnit | null, VolumeUnit | null][] = [
    ['Odo (km)', 'Fuel (litres)', DistanceUnit.KILOMETERS, VolumeUnit.LITERS],
    ['Odo (mi)', 'Fuel (us gallons)', DistanceUnit.MILES, VolumeUnit.GALLONS_US],
    ['Odo (mi)', 'Fuel (uk gallons)', DistanceUnit.MILES, VolumeUnit.GALLONS_UK],
    ['Odo (miles)', 'Fuel (gallons)', DistanceUnit.MILES, VolumeUnit.GALLONS_US], // bare gallons → US
    ['Odo (kilometers)', 'Fuel (liters)', DistanceUnit.KILOMETERS, VolumeUnit.LITERS], // US spelling
    ['Odometer', 'Fuel', null, null], // undecorated → unknown, so no conversion is attempted
  ];

  for (const [odoHeader, fuelHeader, distance, volume] of CASES) {
    test(`${odoHeader} / ${fuelHeader} → ${distance ?? 'unknown'} / ${volume ?? 'unknown'}`, () => {
      const r = parseFuelioExport(fileWithLogHeaders(odoHeader, fuelHeader), {
        targetVehicle: TARGET_VEHICLE,
        targetUnits: TARGET_UNITS,
      });
      expect(r.fileDistanceUnit).toBe(distance);
      expect(r.fileVolumeUnit).toBe(volume);
    });
  }

  test('an imperial file into a miles vehicle passes the odometer through unconverted', () => {
    const r = parseFuelioExport(
      fileWithLogHeaders('Odo (mi)', 'Fuel (us gallons)', '45210', '11.5'),
      {
        targetVehicle: TARGET_VEHICLE,
        targetUnits: TARGET_UNITS,
      }
    );
    const row = buildImportPlan(r.csv, VEHICLES).rows[0];
    expect(row?.status).toBe('ready');
    expect(row?.expense?.mileage).toBe(45210); // same unit in and out — no conversion drift
    expect(row?.expense?.volume).toBe(11.5);
  });
});

describe('per-row errors survive the adapter', () => {
  test('a fill-up with a blank price is reported, not silently imported', () => {
    // Every fixture row had a price, so the per-row error path was never exercised end-to-end.
    const csv = `"## Vehicle"
"Name","ImportCSVDateFormat"
"Golf","yyyy-MM-dd"

"## Log"
"Data","Odo (km)","Fuel (litres)","Price","Missed"
"2024-01-05","45210","42.10","68.90",0
"2024-01-19","45620","20.00","",1
`;
    const r = parseFuelioExport(csv, {
      targetVehicle: TARGET_VEHICLE,
      targetUnits: TARGET_UNITS,
    });
    const plan = buildImportPlan(r.csv, VEHICLES);
    expect(plan.readyCount).toBe(1);
    expect(plan.errorCount).toBe(1);
    expect(plan.rows.find((row) => row.status === 'error')?.message).toMatch(/amount/i);
  });
});

describe('re-importing the same export dedups', () => {
  test('every emitted row carries a distinct clientId, including identical fill-ups', () => {
    // The load-bearing property. Dedup is (userId, clientId) and clientId is derived from the row's
    // own values, so two genuinely identical fill-ups would collide — and one real refuel would be
    // dropped — without the occurrence index that distinguishes them.
    const twinRows = `"## Vehicle"
"Name","ImportCSVDateFormat"
"Golf","yyyy-MM-dd"

"## Log"
"Data","Odo (km)","Fuel (litres)","Price","Missed"
"2024-01-05","45210","42.10","68.90",0
"2024-01-05","45210","42.10","68.90",0
`;
    const r = parseFuelioExport(twinRows, {
      targetVehicle: TARGET_VEHICLE,
      targetUnits: TARGET_UNITS,
    });
    const plan = buildImportPlan(r.csv, VEHICLES);
    const ids = plan.rows.map((row) => row.expense?.clientId);
    expect(plan.readyCount).toBe(2);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(2); // distinct → both survive, neither is silently dropped
  });

  test('the same file re-parsed derives the same clientIds (stable dedup key)', () => {
    // Weaker than it looks — one build re-running one pure path — so it guards a *shape* change
    // (a clock, a random salt, or Map-order leaking into the key), not rounding drift across versions.
    const ids = () => {
      const r = parseFuelioExport(FUELIO_CSV, {
        targetVehicle: TARGET_VEHICLE,
        targetUnits: TARGET_UNITS,
      });
      return buildImportPlan(r.csv, VEHICLES).rows.map((row) => row.expense?.clientId);
    };
    expect(ids()).toEqual(ids());
  });
});
