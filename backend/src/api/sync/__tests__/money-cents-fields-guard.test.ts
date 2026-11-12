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

const EXPECTED_MONEY_FIELDS = new Set<string>([
  'purchasePrice',
  'originalAmount',
  'paymentAmount',
  'residualValue',
  'excessMileageFee',
  'deductibleAmount',
  'coverageLimit',
  'totalCost',
  'monthlyCost',
  'payoutAmount',
  'expenseAmount',
  'groupTotal',
]);

describe('MONEY_CENTS_FIELDS drift guard (restore-shim allowlist)', () => {
  test('matches the expected money-field set exactly', () => {
    expect(new Set(MONEY_CENTS_FIELDS)).toEqual(EXPECTED_MONEY_FIELDS);
  });

  test('every allowlisted name is a REAL integer (cents) column on at least one table', () => {
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
    for (const nonMoney of ['apr', 'volume', 'businessMileageRate', 'mileage', 'termMonths']) {
      expect(MONEY_CENTS_FIELDS.has(nonMoney), `${nonMoney} must NOT be shimmed`).toBe(false);
    }
  });
});

describe('coerceRow money shim contract (Sheets no-shim vs ZIP pre-cents shim)', () => {
  test('NO shim: a cents money string is preserved EXACTLY (the live-Sheets / 2.0.0-ZIP path)', () => {
    const row = {
      id: 'e1',
      vehicleId: 'v1',
      userId: 'u1',
      category: 'fuel',
      expenseAmount: '4550',
    };
    const out = coerceRow(row, expenses);
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
    expect(out.expenseAmount).toBe(4550);
  });

  test('WITH shim does NOT touch a non-money real (volume gal/kWh stays as-is)', () => {
    const row = { id: 'e1', vehicleId: 'v1', userId: 'u1', category: 'fuel', volume: '11.5' };
    const out = coerceRow(row, expenses, { shimMoneyToCents: true });
    expect(out.volume).toBe(11.5);
  });
});
