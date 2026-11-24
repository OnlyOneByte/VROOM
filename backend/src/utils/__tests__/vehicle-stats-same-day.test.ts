import { describe, expect, test } from 'bun:test';
import { calculateVehicleStats, type FuelExpense } from '../vehicle-stats';

function fill(id: string, day: string, mileage: number, fuelType: string): FuelExpense {
  return {
    id,
    mileage,
    volume: 10,
    fuelType,
    date: new Date(`${day}T12:00:00Z`),
    expenseAmount: 4_000,
    missedFillup: false,
  };
}

describe('vehicle stats pair same-day fill-ups by odometer', () => {
  for (const [label, higherFirst] of [
    ['the lower reading first', false],
    ['the higher reading first', true],
  ] as const) {
    test(`economy is right with ${label}`, () => {
      const sameDay = [
        fill('low', '2024-03-10', 10_300, 'Regular'),
        fill('high', '2024-03-10', 10_600, 'Regular'),
      ];
      const fills = [
        fill('start', '2024-03-01', 10_000, 'Regular'),
        ...(higherFirst ? sameDay.reverse() : sameDay),
        fill('end', '2024-03-20', 10_900, 'Regular'),
      ];
      expect(calculateVehicleStats(fills, 10_000).averageMpg).toBeCloseTo(30, 9);

      const charges = fills.map((f) => ({ ...f, volume: 100, fuelType: 'Level 2 (AC)' }));
      const ev = calculateVehicleStats(charges, 10_000, false, true);
      expect(ev.averageMilesPerKwh).toBeCloseTo(3, 9);
    });
  }
});
