/**
 * The seed script writes money in CENTS, like everything else that touches these columns.
 *
 * This is a source scan rather than a round-trip because `seed.ts` writes through the `db` singleton
 * bound to the real file — there is no handle to point at an in-memory database.
 *
 * The bug it guards: every money value in the seed was a DOLLAR literal (`expenseAmount: 45.5`),
 * left behind when money moved to integer cents. SQLite does not reject a float in an INTEGER
 * column — a value it cannot losslessly convert keeps its own type — so the write succeeded, the
 * column reported INTEGER affinity, and the display edge divided by 100 anyway. Every seeded amount
 * rendered at roughly a hundredth of its intent ($0.46 for a tank of fuel) and nothing failed.
 *
 * Wrapping each literal in `dollarsToCents()` keeps the sample data readable as dollars while making
 * the unit explicit at the assignment, which is what makes the next one reviewable.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ratchet } from '../../test-helpers/debt-ratchet';

const SEED_PATH = join(import.meta.dir, '../seed.ts');

/** Columns stored as integer cents. Mirrors `MONEY_COLUMNS` in `migration-0000.test.ts`. */
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

/**
 * A money field assigned a bare numeric literal — the exact shape of the defect. An assignment
 * naming `dollarsToCents(...)`, or forwarding a variable, does not match.
 */
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
    // Fixtures, not the live file: anchoring on a real offender would make this unsatisfiable the
    // moment the last one is fixed, which is the state it is in now.
    expect(offendingLines('        expenseAmount: 45.5,')).toHaveLength(1);
    expect(offendingLines('        purchasePrice: 22000,')).toHaveLength(1);
    expect(offendingLines('      paymentAmount: 372.86,')).toHaveLength(1);
    expect(offendingLines('        expenseAmount: dollarsToCents(45.5),')).toEqual([]);
    expect(offendingLines('        groupTotal: splitGroupTotal,')).toEqual([]);
    // Non-money numeric fields must not be swept up.
    expect(offendingLines('        year: 2022,')).toEqual([]);
    expect(offendingLines('        termMonths: 60,')).toEqual([]);
  },
});

describe('the seed script converts through the shared helper', () => {
  test('it imports dollarsToCents (so the scan above has something to find)', () => {
    // Guards the scan's premise: if the import vanished, every call site would be a type error
    // rather than a silent unit bug, but the guard would still read green.
    expect(readFileSync(SEED_PATH, 'utf-8')).toContain("from '../utils/money'");
  });
});
