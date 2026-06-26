/**
 * Drift guard for MONEY_CENTS_FIELDS (money-cents-migration data-safety, C20 deep-review).
 *
 * MONEY_CENTS_FIELDS is the allowlist the pre-cents restore shim (coerceRow shimMoneyToCents) ×100s when
 * importing an old (< 2.0.0) dollar backup. It is matched against coerceRow's `columnName`, which is the
 * drizzle FIELD name (camelCase) from getTableColumns — NOT the snake_case DB column. Two silent-corruption
 * risks this guard pins (both NORTH_STAR #1):
 *   1. A money field MISSING from the set → an old backup's dollars are NOT ×100'd → stored 100× low ($0.12
 *      for $12.34). So the set must list EVERY money field name.
 *   2. A name in the set that is NOT actually an integer column on some table → the shim never matches it
 *      (dead entry) OR (worse) it matches a wrong column. So every entry must be a real integer field.
 * It also confirms the known NON-money reals (apr %, volume gal/kWh, businessMileageRate $/mile rate) are
 * NOT in the set (they must never be ×100'd).
 *
 * If a future migration adds a 15th money column, this guard FAILS until MONEY_CENTS_FIELDS is updated —
 * exactly the forget-to-add-it regression that would otherwise corrupt that column on every old-backup restore.
 */

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
import { MONEY_CENTS_FIELDS } from '../backup';

/** The 14 money columns (design §1) by drizzle field name — 12 DISTINCT names (paymentAmount + expenseAmount
 *  each appear on two tables). This is the human-maintained source of truth the migration was built against. */
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
  test('matches the expected 12-name money-field set exactly (add a new money column → update both)', () => {
    expect(new Set(MONEY_CENTS_FIELDS)).toEqual(EXPECTED_MONEY_FIELDS);
  });

  test('every allowlisted name is a REAL integer (cents) column on at least one table', () => {
    // coerceRow keys MONEY_CENTS_FIELDS.has(columnName) where columnName is the drizzle field name and the
    // money columns are now `integer`. A typo'd entry would be a SQLiteInteger nowhere → silently never shim.
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
    // apr (percent), volume (gal/kWh), businessMileageRate ($/mile rate, design-excluded) stay `real`.
    for (const nonMoney of ['apr', 'volume', 'businessMileageRate', 'mileage', 'termMonths']) {
      expect(MONEY_CENTS_FIELDS.has(nonMoney), `${nonMoney} must NOT be shimmed`).toBe(false);
    }
  });
});
