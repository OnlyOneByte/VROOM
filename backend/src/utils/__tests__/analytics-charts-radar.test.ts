import { describe, expect, test } from 'bun:test';
import {
  buildVehicleRadar,
  type FuelExpenseRow,
  type GeneralExpenseRow,
} from '../analytics-charts';

function fill(over: Partial<FuelExpenseRow> & { vehicleId: string }): FuelExpenseRow {
  return {
    date: new Date(2024, 0, 1),
    mileage: null,
    volume: null,
    fuelType: 'Regular',
    missedFillup: false,
    expenseAmount: 40,
    ...over,
  };
}

const names = new Map([
  ['gas-a', 'Gas A'],
  ['gas-b', 'Gas B'],
  ['no-fillups', 'No Fill-ups'],
  ['ev', 'EV'],
]);

const fuelRows: FuelExpenseRow[] = [
  fill({ vehicleId: 'gas-a', mileage: 10000, volume: 10, date: new Date(2024, 0, 1) }),
  fill({ vehicleId: 'gas-a', mileage: 10300, volume: 10, date: new Date(2024, 0, 15) }),
  fill({ vehicleId: 'gas-b', mileage: 20000, volume: 10, date: new Date(2024, 0, 1) }),
  fill({ vehicleId: 'gas-b', mileage: 20200, volume: 10, date: new Date(2024, 0, 15) }),
  fill({ vehicleId: 'no-fillups', mileage: 5000, volume: 12, date: new Date(2024, 0, 3) }),
  fill({
    vehicleId: 'ev',
    mileage: 1000,
    volume: 30,
    fuelType: 'Electric',
    date: new Date(2024, 0, 2),
  }),
  fill({
    vehicleId: 'ev',
    mileage: 1150,
    volume: 30,
    fuelType: 'Electric',
    date: new Date(2024, 0, 9),
  }),
];

describe('buildVehicleRadar fuel efficiency', () => {
  const radar = buildVehicleRadar([], fuelRows, names);
  const score = (id: string) => radar.find((r) => r.vehicleId === id)?.fuelEfficiency;

  test('a vehicle with no fill-up interval has no score instead of the worst one', () => {
    expect(score('no-fillups')).toBeNull();
  });

  test('an electric vehicle has no fuel efficiency score', () => {
    expect(score('ev')).toBeNull();
  });

  test('vehicles with data are scored only against each other, and the worst still draws a bar', () => {
    expect(score('gas-a')).toBe(100);
    expect(score('gas-b')).toBe(10);
  });

  test('the raw value is the economy itself, unit-converted, beside the score', () => {
    const raw = (r: typeof radar, id: string) =>
      r.find((v) => v.vehicleId === id)?.fuelEfficiencyValue;
    expect(raw(radar, 'gas-a')).toBe(30);
    expect(raw(radar, 'gas-b')).toBe(20);
    expect(raw(radar, 'ev')).toBeNull();
    const kmPerLitre = (mpg: number) => mpg * 0.425144;
    const converted = buildVehicleRadar([], fuelRows, names, {
      efficiency: (value) => kmPerLitre(value),
      distance: (value) => value * 1.609344,
    });
    expect(raw(converted, 'gas-a')).toBeCloseTo(kmPerLitre(30));
    expect(raw(converted, 'gas-b')).toBeCloseTo(kmPerLitre(20));
    expect(converted.find((v) => v.vehicleId === 'gas-a')?.fuelEfficiency).toBe(100);
  });

  test('a single vehicle with data gets the midpoint', () => {
    const solo = buildVehicleRadar([], fuelRows.slice(0, 2), names);
    expect(solo.find((r) => r.vehicleId === 'gas-a')?.fuelEfficiency).toBe(50);
    expect(solo.find((r) => r.vehicleId === 'gas-b')?.fuelEfficiency).toBeNull();
  });
});

function maintenance(vehicleId: string, expenseAmount: number): GeneralExpenseRow {
  return {
    id: `m-${vehicleId}`,
    vehicleId,
    category: 'maintenance',
    description: null,
    expenseAmount,
    date: new Date(2024, 0, 1),
    mileage: null,
    volume: null,
    fuelType: null,
    missedFillup: false,
  };
}

describe('buildVehicleRadar score scale', () => {
  const fleet = new Map([
    ['cheap', 'Cheap'],
    ['middle', 'Middle'],
    ['pricey', 'Pricey'],
  ]);
  const radar = buildVehicleRadar(
    [maintenance('cheap', 100), maintenance('middle', 300), maintenance('pricey', 500)],
    [],
    fleet
  );
  const row = (id: string) => radar.find((r) => r.vehicleId === id);

  test('a cost metric gives the highest cost 10 and the lowest 100', () => {
    expect(row('pricey')?.maintenanceCost).toBe(10);
    expect(row('cheap')?.maintenanceCost).toBe(100);
    expect(row('pricey')?.annualCost).toBe(10);
    expect(row('cheap')?.annualCost).toBe(100);
  });

  test('a value halfway between the worst and the best scores 55, not a clamped 50', () => {
    expect(row('middle')?.maintenanceCost).toBe(55);
    expect(row('middle')?.annualCost).toBe(55);
  });
});
