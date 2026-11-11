// MONEY_CENTS_FIELDS lists the money fields the pre-cents restore shim scales. It is matched against
// camelCase field names. A missing entry leaves old dollar amounts 100x low, and a wrong entry
// scales a non-money column. Fails when a money column is added without updating the set.

import { describe, expect, test } from 'bun:test';
import { getTableColumns } from 'drizzle-orm';
import {
  expenses,
  insuranceClaims,
  insuranceTerms,
  reminders,
  vehicleFinancing,
  vehicles,
} from '../../../db/schema';
import { coerceRow, MONEY_CENTS_FIELDS } from '../backup';

/** Expected money field names. paymentAmount and expenseAmount each appear on two tables. */
const EXPECTED_MONEY_FIELDS = new Set<string>([
  'purchasePrice', // vehicles
  'originalAmount', // vehicleFinancing
  'paymentAmount', // vehicleFinancing + insuranceTerms
  'residualValue', // vehicleFinancing
  'excessMileageFee', // vehicleFinancing
  'deductibleAmount', // insuranceTerms
  'coverageLimit', // insuranceTerms
  'totalCost', // insuranceTerms
  'monthlyCost', // insuranceTerms
  'payoutAmount', // insuranceClaims
  'expenseAmount', // expenses + reminders
  'groupTotal', // expenses
]);

describe('MONEY_CENTS_FIELDS drift guard (restore-shim allowlist)', () => {
  test('matches the expected money-field set exactly', () => {
    expect(new Set(MONEY_CENTS_FIELDS)).toEqual(EXPECTED_MONEY_FIELDS);
  });

  test('every allowlisted name is a REAL integer (cents) column on at least one table', () => {
    // A typo'd entry would match no integer column and never shim.
    const tables = [
      vehicles,
      vehicleFinancing,
      insuranceTerms,
      insuranceClaims,
      expenses,
      reminders,
    ];
    const integerFieldNames = new Set<string>();
    for (const t of tables) {
      for (const [name, col] of Object.entries(getTableColumns(t))) {
        // biome-ignore lint/suspicious/noExplicitAny: drizzle column type not fully exposed
        if ((col as any).columnType === 'SQLiteInteger') integerFieldNames.add(name);
      }
    }
    for (const field of MONEY_CENTS_FIELDS) {
      expect(integerFieldNames.has(field), `${field} must be an integer column`).toBe(true);
    }
  });

  test('the known NON-money reals are NOT in the allowlist (never ×100 a percent/quantity/rate)', () => {
    // apr is a percent, volume a quantity, and businessMileageRate a rate. None are cents.
    for (const nonMoney of ['apr', 'volume', 'businessMileageRate', 'mileage', 'termMonths']) {
      expect(MONEY_CENTS_FIELDS.has(nonMoney), `${nonMoney} must NOT be shimmed`).toBe(false);
    }
  });
});

// Sheets restores hold cents and skip the shim. Pre-2.0.0 ZIP restores hold dollars and apply it.
// Applying the shim to cents would overstate them 100x.
describe('coerceRow money shim contract (Sheets no-shim vs ZIP pre-cents shim)', () => {
  test('NO shim: a cents money string is preserved EXACTLY (the live-Sheets / 2.0.0-ZIP path)', () => {
    // 4550 is $45.50 in cents. Without the shim it must stay 4550, not become 455000.
    const row = {
      id: 'e1',
      vehicleId: 'v1',
      userId: 'u1',
      category: 'fuel',
      expenseAmount: '4550',
    };
    const out = coerceRow(row, expenses); // no options → no shim
    expect(out.expenseAmount).toBe(4550);
  });

  test('WITH shim: a pre-cents DOLLAR string is ×100-rounded to cents (the 1.0.0-ZIP recovery path)', () => {
    const row = {
      id: 'e1',
      vehicleId: 'v1',
      userId: 'u1',
      category: 'fuel',
      expenseAmount: '45.50',
    };
    const out = coerceRow(row, expenses, { shimMoneyToCents: true });
    expect(out.expenseAmount).toBe(4550); // $45.50 → 4550 cents
  });

  test('WITH shim does NOT touch a non-money real (volume gal/kWh stays as-is)', () => {
    const row = { id: 'e1', vehicleId: 'v1', userId: 'u1', category: 'fuel', volume: '11.5' };
    const out = coerceRow(row, expenses, { shimMoneyToCents: true });
    expect(out.volume).toBe(11.5); // volume is not money — never ×100, even with the shim on
  });
});
