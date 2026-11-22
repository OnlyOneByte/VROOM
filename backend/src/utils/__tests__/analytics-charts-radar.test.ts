import { describe, expect, test } from 'bun:test';
import { buildVehicleRadar, type FuelExpenseRow } from '../analytics-charts';

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

  test('vehicles with data are scored only against each other', () => {
    expect(score('gas-a')).toBe(100);
    expect(score('gas-b')).toBe(0);
  });

  test('a single vehicle with data gets the midpoint', () => {
    const solo = buildVehicleRadar([], fuelRows.slice(0, 2), names);
    expect(solo.find((r) => r.vehicleId === 'gas-a')?.fuelEfficiency).toBe(50);
    expect(solo.find((r) => r.vehicleId === 'gas-b')?.fuelEfficiency).toBeNull();
  });
});
