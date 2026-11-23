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
import { coerceRow, MONEY_CENTS_FIELDS, upgradeBackupTables } from '../backup';

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

function restoredExpense(version: string, row: Record<string, unknown>): Record<string, unknown> {
  const [upgraded] = upgradeBackupTables(version, { expenses: [row] }).expenses;
  return coerceRow(upgraded, expenses);
}

describe('pre-cents upgrade step contract (2.0.0 as-is vs 1.x dollars to cents)', () => {
  const base = { id: 'e1', vehicleId: 'v1', userId: 'u1', category: 'fuel' };

  test('a 2.0.0 cents money string is preserved EXACTLY (the live-Sheets / 2.0.0-ZIP path)', () => {
    expect(restoredExpense('2.0.0', { ...base, expenseAmount: '4550' }).expenseAmount).toBe(4550);
  });

  test('a 1.x DOLLAR string is ×100-rounded to cents (the 1.0.0-ZIP recovery path)', () => {
    expect(restoredExpense('1.0.0', { ...base, expenseAmount: '45.50' }).expenseAmount).toBe(4550);
    expect(restoredExpense('1.0.0', { ...base, expenseAmount: '1,234.56' }).expenseAmount).toBe(
      123456
    );
  });

  test('the 1.x step does NOT touch a non-money real (volume gal/kWh stays as-is)', () => {
    expect(restoredExpense('1.0.0', { ...base, volume: '11.5' }).volume).toBe(11.5);
  });

  test('the 1.x step leaves a blank money cell blank', () => {
    expect(restoredExpense('1.0.0', { ...base, expenseAmount: '' }).expenseAmount).toBe(
      restoredExpense('2.0.0', { ...base, expenseAmount: '' }).expenseAmount
    );
  });
});
