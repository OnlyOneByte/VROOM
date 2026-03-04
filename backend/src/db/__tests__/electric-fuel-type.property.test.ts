import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { ELECTRIC_FUEL_TYPES, isElectricFuelType } from '../types';

/**
 * Property 3: isElectricFuelType consistency
 * Validates: Requirements 8.2, 8.3, 8.4
 */
describe('Property 3: isElectricFuelType consistency', () => {
  test('returns true for all ELECTRIC_FUEL_TYPES values', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ELECTRIC_FUEL_TYPES), (fuelType) => {
        expect(isElectricFuelType(fuelType)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  test('returns false for any string not in ELECTRIC_FUEL_TYPES', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !(ELECTRIC_FUEL_TYPES as readonly string[]).includes(s)),
        (fuelType) => {
          expect(isElectricFuelType(fuelType)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  test('returns false for null', () => {
    expect(isElectricFuelType(null)).toBe(false);
  });

  test('returns false for known non-electric fuel type strings', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          '87 (Regular)',
          '89 (Mid-Grade)',
          '91 (Premium)',
          '93 (Super Premium)',
          'Diesel',
          'Ethanol-Free',
          'Other'
        ),
        (fuelType) => {
          expect(isElectricFuelType(fuelType)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });
});
