/**
 * Characterization net for the vehicle + financing form validators (guard, C125 — FE coverage ratchet).
 *
 * vehicle-form-validation.ts sat at ~15% line / 8% branch — two PURE validators that gate what vehicle/
 * financing data enters the DB, with almost every branch untested. High-risk pure logic (the C82 class),
 * host-independent (no mocks). Pins: each required-field + range branch returns the right error key, a
 * fully-valid form returns {}, the year boundary (1900 .. now+2, computed relative to `now` so it holds
 * on any host), the VIN regex + 11–17 length band, the financing `own`-skip short-circuit, and the
 * loan-only APR band.
 *
 * The validators take typed form objects; tests build a minimal valid base + override per case.
 */

import { describe, expect, test } from 'vitest';
import type { VehicleFormData } from '$lib/types';
import { validateFinancingFields, validateVehicleFields } from '../vehicle-form-validation';

function vehicle(overrides: Partial<VehicleFormData> = {}): VehicleFormData {
  return {
    make: 'Honda',
    model: 'Civic',
    year: 2021,
    vin: '',
    initialMileage: undefined,
    purchasePrice: undefined,
    ...overrides,
  } as VehicleFormData;
}

interface FinancingForm {
  financingType: 'loan' | 'lease' | 'own';
  provider: string;
  originalAmount: number;
  apr: number;
  termMonths: number;
  startDate: string | undefined;
  paymentAmount: number;
}
function financing(overrides: Partial<FinancingForm> = {}): FinancingForm {
  return {
    financingType: 'loan',
    provider: 'Bank',
    originalAmount: 20000,
    apr: 5,
    termMonths: 60,
    startDate: '2024-01-01',
    paymentAmount: 400,
    ...overrides,
  };
}

describe('validateVehicleFields', () => {
  test('a fully valid vehicle has no errors', () => {
    expect(validateVehicleFields(vehicle())).toEqual({});
  });

  test('make and model are required (blank/whitespace)', () => {
    expect(validateVehicleFields(vehicle({ make: '   ' })).make).toBe('Make is required');
    expect(validateVehicleFields(vehicle({ model: '' })).model).toBe('Model is required');
  });

  test('year must be within 1900 .. currentYear + 2 (boundary, computed vs now)', () => {
    const maxYear = new Date().getFullYear() + 2;
    expect(validateVehicleFields(vehicle({ year: 1899 })).year).toBe('Please enter a valid year');
    expect(validateVehicleFields(vehicle({ year: maxYear + 1 })).year).toBe('Please enter a valid year');
    // The inclusive boundaries are valid.
    expect(validateVehicleFields(vehicle({ year: 1900 })).year).toBeUndefined();
    expect(validateVehicleFields(vehicle({ year: maxYear })).year).toBeUndefined();
  });

  test('VIN: only alphanumerics, and 11–17 chars when present', () => {
    expect(validateVehicleFields(vehicle({ vin: 'ABC-123!' })).vin).toBe(
      'VIN must contain only letters and numbers'
    );
    expect(validateVehicleFields(vehicle({ vin: 'ABC123' })).vin).toBe(
      'VIN must be between 11 and 17 characters'
    ); // 6 chars — too short
    expect(validateVehicleFields(vehicle({ vin: '1HGBH41JXMN109186' })).vin).toBeUndefined(); // 17, valid
    expect(validateVehicleFields(vehicle({ vin: '' })).vin).toBeUndefined(); // absent → not validated
  });

  test('initialMileage and purchasePrice cannot be negative (but undefined is fine)', () => {
    expect(validateVehicleFields(vehicle({ initialMileage: -1 })).initialMileage).toBe(
      'Mileage cannot be negative'
    );
    expect(validateVehicleFields(vehicle({ purchasePrice: -1 })).purchasePrice).toBe(
      'Purchase price cannot be negative'
    );
    expect(validateVehicleFields(vehicle({ initialMileage: 0, purchasePrice: 0 }))).toEqual({});
  });
});

describe('validateFinancingFields', () => {
  test("ownershipType 'own' short-circuits to no validation", () => {
    // Even an all-invalid form is skipped when owned outright.
    const allBad = financing({ provider: '', originalAmount: 0, termMonths: 0, paymentAmount: 0 });
    expect(validateFinancingFields(allBad, 'own')).toEqual({});
  });

  test('a valid financing form (lease) has no errors', () => {
    expect(validateFinancingFields(financing({ financingType: 'lease' }), 'lease')).toEqual({});
  });

  test('provider/amount/term/startDate/payment are validated', () => {
    const e = validateFinancingFields(
      financing({
        provider: '  ',
        originalAmount: 0,
        termMonths: 0,
        startDate: undefined,
        paymentAmount: 0,
      }),
      'finance'
    );
    expect(e.provider).toBe('Provider is required');
    expect(e.originalAmount).toBe('Amount must be greater than 0');
    expect(e.termMonths).toBe('Term must be between 1 and 600 months');
    expect(e.startDate).toBe('Start date is required');
    expect(e.paymentAmount).toBe('Payment amount must be greater than 0');
  });

  test('APR 0–50 band is loan-only (a lease with a wild apr is not flagged)', () => {
    expect(validateFinancingFields(financing({ financingType: 'loan', apr: 60 }), 'finance').apr).toBe(
      'APR must be between 0% and 50%'
    );
    expect(validateFinancingFields(financing({ financingType: 'loan', apr: -1 }), 'finance').apr).toBe(
      'APR must be between 0% and 50%'
    );
    // A lease never has its apr checked (the band is guarded by financingType === 'loan').
    expect(
      validateFinancingFields(financing({ financingType: 'lease', apr: 999 }), 'finance').apr
    ).toBeUndefined();
  });

  test('term boundary 1..600 inclusive is valid', () => {
    expect(validateFinancingFields(financing({ termMonths: 1 }), 'finance').termMonths).toBeUndefined();
    expect(validateFinancingFields(financing({ termMonths: 600 }), 'finance').termMonths).toBeUndefined();
    expect(validateFinancingFields(financing({ termMonths: 601 }), 'finance').termMonths).toBe(
      'Term must be between 1 and 600 months'
    );
  });
});
