import { describe, expect, test } from 'bun:test';
import { DistanceUnit, VolumeUnit } from '../../../types';
import { convertDistance, convertVolume } from '../../../utils/unit-conversions';
import { isFuelioExport, parseFuelioExport } from '../fuelio-import';
import { buildImportPlan, type ImportableExpense, type ImportVehicle } from '../import-csv';

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

function categoryCounts(csv: string): { fuel: number; other: number } {
  const plan = buildImportPlan(csv, VEHICLES);
  const fuel = plan.rows.filter((r) => r.expense?.category === 'fuel').length;
  return { fuel, other: plan.rows.length - fuel };
}

describe('isFuelioExport', () => {
  test('recognizes a Fuelio multi-section export', () => {
    expect(isFuelioExport(FUELIO_CSV)).toBe(true);
  });
});

describe('parseFuelioExport', () => {
  test('emits every log and cost row and reports the unmapped cost category', () => {
    const r = parseFuelioExport(FUELIO_CSV, {
      targetVehicle: TARGET_VEHICLE,
      targetUnits: TARGET_UNITS,
    });
    expect(categoryCounts(r.csv)).toEqual({ fuel: 2, other: 2 });
    expect(r.unmappedCategories).toEqual(['Ferry']);
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
    expect(categoryCounts(r.csv)).toEqual({ fuel: 2, other: 0 });
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
    const fuel: ImportableExpense[] = plan.rows.flatMap((r) =>
      r.expense?.category === 'fuel' ? [r.expense] : []
    );
    expect(fuel).toHaveLength(2);

    const full = fuel[0];
    expect(full.expenseAmount).toBe(6890);
    expect(full.mileage).toBe(
      Math.round(convertDistance(45210, DistanceUnit.KILOMETERS, DistanceUnit.MILES))
    );
    expect(full.volume).toBeCloseTo(
      convertVolume(42.1, VolumeUnit.LITERS, VolumeUnit.GALLONS_US),
      2
    );
    expect(full.missedFillup).toBe(false);

    const partial = fuel[1];
    expect(partial.expenseAmount).toBe(3280);
    expect(partial.missedFillup).toBe(true);
  });

  test('cost rows: category-mapped, cents amount, no fuel fields leaked', () => {
    const costs: ImportableExpense[] = plan.rows.flatMap((r) =>
      r.expense && r.expense.category !== 'fuel' ? [r.expense] : []
    );
    expect(costs).toHaveLength(2);

    const service = costs.find((e) => e.description?.includes('Oil change'));
    if (!service) throw new Error('no "Oil change" cost row in the plan');
    expect(service.category).toBe('maintenance');
    expect(service.expenseAmount).toBe(8900);
    expect(service.mileage).toBeNull();
    expect(service.volume).toBeNull();

    const ferry = costs.find((e) => e.description?.includes('Ferry'));
    if (!ferry) throw new Error('no "Ferry" cost row in the plan');
    expect(ferry.category).toBe('misc');
    expect(ferry.expenseAmount).toBe(2500);
  });
});

describe('cost categories that resolve to no name are still surfaced (never a silent misc)', () => {
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

  const NO_CATEGORIES_CSV = ORPHAN_ID_CSV.replace(
    /"## CostCategories"\n"CostTypeID","Name","priority","color"\n"1","Service","0","#795548"\n\n/,
    ''
  );

  test('an orphaned CostTypeID lands in misc AND is reported by id', () => {
    const r = parseFuelioExport(ORPHAN_ID_CSV, {
      targetVehicle: TARGET_VEHICLE,
      targetUnits: TARGET_UNITS,
    });
    expect(categoryCounts(r.csv)).toEqual({ fuel: 1, other: 1 });
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
    expect(categoryCounts(r.csv)).toEqual({ fuel: 1, other: 1 });
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

function fileWithLogHeaders(odoHeader: string, fuelHeader: string, odo = '45210', fuel = '42.10') {
  return `"## Vehicle"
"Name","ImportCSVDateFormat"
"Golf","yyyy-MM-dd"

"## Log"
"Data","${odoHeader}","${fuelHeader}","Price","Missed"
"2024-01-05","${odo}","${fuel}","68.90",0
`;
}

describe('the ## Log header units drive conversion into the vehicle units', () => {
  const CASES: [string, string, DistanceUnit | null, VolumeUnit | null][] = [
    ['Odo (km)', 'Fuel (litres)', DistanceUnit.KILOMETERS, VolumeUnit.LITERS],
    ['Odo (mi)', 'Fuel (us gallons)', DistanceUnit.MILES, VolumeUnit.GALLONS_US],
    ['Odo (mi)', 'Fuel (uk gallons)', DistanceUnit.MILES, VolumeUnit.GALLONS_UK],
    ['Odo (miles)', 'Fuel (gallons)', DistanceUnit.MILES, VolumeUnit.GALLONS_US],
    ['Odo (kilometers)', 'Fuel (liters)', DistanceUnit.KILOMETERS, VolumeUnit.LITERS],
    ['Odometer', 'Fuel', null, null],
  ];

  for (const [odoHeader, fuelHeader, distance, volume] of CASES) {
    test(`${odoHeader} / ${fuelHeader} → ${distance ?? 'unknown'} / ${volume ?? 'unknown'}`, () => {
      const r = parseFuelioExport(fileWithLogHeaders(odoHeader, fuelHeader), {
        targetVehicle: TARGET_VEHICLE,
        targetUnits: TARGET_UNITS,
      });
      const expense = buildImportPlan(r.csv, VEHICLES).rows[0]?.expense;
      expect(expense?.mileage).toBe(
        distance ? Math.round(convertDistance(45210, distance, DistanceUnit.MILES)) : 45210
      );
      expect(expense?.volume).toBeCloseTo(
        volume ? convertVolume(42.1, volume, VolumeUnit.GALLONS_US) : 42.1,
        2
      );
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
    expect(row?.expense?.mileage).toBe(45210);
    expect(row?.expense?.volume).toBe(11.5);
  });
});

describe('per-row errors survive the adapter', () => {
  test('a fill-up with a blank price is reported, not silently imported', () => {
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
    expect(new Set(ids).size).toBe(2);
  });

  test('the same file re-parsed derives the same clientIds (stable dedup key)', () => {
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
