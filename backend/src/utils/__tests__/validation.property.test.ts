import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { ELECTRIC_FUEL_TYPES, EXPENSE_CATEGORIES } from '../../db/types';
import { ValidationError } from '../../errors';
import { validateFuelExpenseData } from '../validation';

const NON_ELECTRIC_FUEL_TYPES = [
  '87 (Regular)',
  '89 (Mid-Grade)',
  '91 (Premium)',
  '93 (Super Premium)',
  'Diesel',
  'Ethanol-Free',
  'Other',
] as const;

const NON_FUEL_CATEGORIES = EXPENSE_CATEGORIES.filter((c) => c !== 'fuel');

const positiveFuelAmountArb = fc.double({ min: 0.01, max: 500, noNaN: true });

const positiveMileageArb = fc.integer({ min: 1, max: 500000 });

const electricFuelTypeArb = fc.constantFrom(...ELECTRIC_FUEL_TYPES);

const nonElectricFuelTypeArb = fc.constantFrom(...NON_ELECTRIC_FUEL_TYPES);

const anyFuelTypeArb = fc.oneof(electricFuelTypeArb, nonElectricFuelTypeArb);

const nonFuelCategoryArb = fc.constantFrom(...NON_FUEL_CATEGORIES);

const missingValueArb = fc.constantFrom(null, undefined, 0);

describe('fuelType-based validation', () => {
  test('fuel-category + electric fuelType: valid when both volume and mileage present', () => {
    fc.assert(
      fc.property(
        electricFuelTypeArb,
        positiveFuelAmountArb,
        positiveMileageArb,
        (fuelType, volume, mileage) => {
          expect(() => validateFuelExpenseData('fuel', mileage, volume, fuelType)).not.toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  test('fuel-category + electric fuelType: throws when volume is missing', () => {
    fc.assert(
      fc.property(
        electricFuelTypeArb,
        positiveMileageArb,
        missingValueArb,
        (fuelType, mileage, missingFuel) => {
          expect(() => validateFuelExpenseData('fuel', mileage, missingFuel, fuelType)).toThrow(
            ValidationError
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  test('fuel-category + electric fuelType: throws when mileage is missing', () => {
    fc.assert(
      fc.property(
        electricFuelTypeArb,
        positiveFuelAmountArb,
        missingValueArb,
        (fuelType, volume, missingMileage) => {
          expect(() => validateFuelExpenseData('fuel', missingMileage, volume, fuelType)).toThrow(
            ValidationError
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  test('fuel-category + electric fuelType: error message mentions "charge amount (kWh)"', () => {
    fc.assert(
      fc.property(electricFuelTypeArb, (fuelType) => {
        try {
          validateFuelExpenseData('fuel', null, null, fuelType);
          expect(true).toBe(false);
        } catch (e) {
          expect(e).toBeInstanceOf(ValidationError);
          expect((e as ValidationError).message).toContain('charge amount (kWh)');
        }
      }),
      { numRuns: 100 }
    );
  });

  test('fuel-category + non-electric fuelType: valid when both volume and mileage present', () => {
    fc.assert(
      fc.property(
        nonElectricFuelTypeArb,
        positiveFuelAmountArb,
        positiveMileageArb,
        (fuelType, volume, mileage) => {
          expect(() => validateFuelExpenseData('fuel', mileage, volume, fuelType)).not.toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  test('fuel-category + non-electric fuelType: throws when volume is missing', () => {
    fc.assert(
      fc.property(
        nonElectricFuelTypeArb,
        positiveMileageArb,
        missingValueArb,
        (fuelType, mileage, missingFuel) => {
          expect(() => validateFuelExpenseData('fuel', mileage, missingFuel, fuelType)).toThrow(
            ValidationError
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  test('fuel-category + non-electric fuelType: throws when mileage is missing', () => {
    fc.assert(
      fc.property(
        nonElectricFuelTypeArb,
        positiveFuelAmountArb,
        missingValueArb,
        (fuelType, volume, missingMileage) => {
          expect(() => validateFuelExpenseData('fuel', missingMileage, volume, fuelType)).toThrow(
            ValidationError
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  test('fuel-category + non-electric fuelType: error message mentions "fuel amount"', () => {
    fc.assert(
      fc.property(nonElectricFuelTypeArb, (fuelType) => {
        try {
          validateFuelExpenseData('fuel', null, null, fuelType);
          expect(true).toBe(false);
        } catch (e) {
          expect(e).toBeInstanceOf(ValidationError);
          expect((e as ValidationError).message).toContain('fuel amount');
        }
      }),
      { numRuns: 100 }
    );
  });

  test('non-fuel categories pass regardless of volume, fuelType, or mileage', () => {
    fc.assert(
      fc.property(
        nonFuelCategoryArb,
        fc.option(positiveMileageArb, { nil: undefined }),
        fc.option(positiveFuelAmountArb, { nil: undefined }),
        fc.option(anyFuelTypeArb, { nil: undefined }),
        (category, mileage, volume, fuelType) => {
          expect(() =>
            validateFuelExpenseData(category, mileage ?? null, volume ?? null, fuelType ?? null)
          ).not.toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  test('fuel-category requires volume + mileage regardless of fuelType', () => {
    fc.assert(
      fc.property(
        anyFuelTypeArb,
        positiveFuelAmountArb,
        positiveMileageArb,
        (fuelType, volume, mileage) => {
          expect(() => validateFuelExpenseData('fuel', mileage, volume, fuelType)).not.toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  test('fuel-category throws when both volume and mileage are missing regardless of fuelType', () => {
    fc.assert(
      fc.property(anyFuelTypeArb, (fuelType) => {
        expect(() => validateFuelExpenseData('fuel', null, null, fuelType)).toThrow(
          ValidationError
        );
      }),
      { numRuns: 100 }
    );
  });
});
