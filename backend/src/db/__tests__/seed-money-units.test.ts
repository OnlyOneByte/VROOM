// Seed values are integer cents. A bare dollar literal is stored without error and reads back about 100x low.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ratchet } from '../../test-helpers/debt-ratchet';

const SEED_PATH = join(import.meta.dir, '../seed.ts');

// Mirrors MONEY_COLUMNS in migration-0000.test.ts.
const MONEY_FIELDS = [
  'coverageLimit',
  'deductibleAmount',
  'excessMileageFee',
  'expenseAmount',
  'groupTotal',
  'monthlyCost',
  'originalAmount',
  'paymentAmount',
  'payoutAmount',
  'purchasePrice',
  'residualValue',
  'totalCost',
];

// Matches a bare numeric literal. An assignment wrapping dollarsToCents(...) does not match.
const BARE_MONEY_LITERAL = new RegExp(`\\b(?:${MONEY_FIELDS.join('|')}):\\s*-?\\d`);

function offendingLines(source: string): string[] {
  return source
    .split('\n')
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => BARE_MONEY_LITERAL.test(line))
    .map(({ line, number }) => `seed.ts:${number}: ${line}`);
}

ratchet({
  name: 'the seed script states money in cents',
  tolerated: [],
  guidance:
    'These seed values are bare numbers in columns that hold integer CENTS. SQLite accepts a ' +
    'float into an INTEGER column without complaint, so this fails silently and the seeded data ' +
    'reads ~100x low. Wrap the dollar figure: `expenseAmount: dollarsToCents(45.5)`.',
  scan: () => offendingLines(readFileSync(SEED_PATH, 'utf-8')),
  probe: () => {
    // Fixtures rather than the live seed file, so the probe stays satisfiable as offenders are fixed.
    expect(offendingLines('        expenseAmount: 45.5,')).toHaveLength(1);
    expect(offendingLines('        purchasePrice: 22000,')).toHaveLength(1);
    expect(offendingLines('      paymentAmount: 372.86,')).toHaveLength(1);
    expect(offendingLines('        expenseAmount: dollarsToCents(45.5),')).toEqual([]);
    expect(offendingLines('        groupTotal: splitGroupTotal,')).toEqual([]);
    expect(offendingLines('        year: 2022,')).toEqual([]);
    expect(offendingLines('        termMonths: 60,')).toEqual([]);
  },
});

describe('the seed script converts through the shared helper', () => {
  test('it imports dollarsToCents (so the scan above has something to find)', () => {
    expect(readFileSync(SEED_PATH, 'utf-8')).toContain("from '../utils/money'");
  });
});
