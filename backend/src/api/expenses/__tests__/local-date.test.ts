/**
 * Unit tests for the shared `buildLocalDate` helper (C177 arch dedup — the echo-check
 * extracted from import-csv.ts parseDate + import-mapping.ts normalizeForeignDate into one
 * source of truth). The two IMPORT paths keep their own #23/#59 regression tests as the
 * green→green oracle; these pin the extracted primitive's own contract directly.
 *
 * Host-independent: every assertion checks the LOCAL calendar day the helper builds, which
 * is what both callers store — never an absolute UTC instant — so it holds in any CI zone.
 */

import { describe, expect, test } from 'bun:test';
import { buildLocalDate } from '../local-date';

describe('buildLocalDate', () => {
  test('builds a valid date from in-range parts (local calendar day preserved)', () => {
    const d = buildLocalDate(2024, 3, 15);
    expect(d).not.toBeNull();
    // LOCAL parts echo the input — no UTC-midnight day-shift (the cycle-6/11 invariant).
    expect(d?.getFullYear()).toBe(2024);
    expect(d?.getMonth()).toBe(2); // March = month index 2
    expect(d?.getDate()).toBe(15);
  });

  test('defaults the time component to local midnight when omitted', () => {
    const d = buildLocalDate(2024, 6, 1);
    expect(d?.getHours()).toBe(0);
    expect(d?.getMinutes()).toBe(0);
    expect(d?.getSeconds()).toBe(0);
  });

  test('honors an explicit time component', () => {
    const d = buildLocalDate(2024, 6, 1, 13, 30, 45);
    expect(d?.getHours()).toBe(13);
    expect(d?.getMinutes()).toBe(30);
    expect(d?.getSeconds()).toBe(45);
  });

  test('rejects a month past 12 instead of rolling forward (the #23/#59 class)', () => {
    // `new Date(2024, 12, 45)` ("2024-13-45") never NaNs — it rolls to ~2025-02-14.
    // The echo-check must return null so the caller surfaces a clean "Invalid date".
    expect(buildLocalDate(2024, 13, 45)).toBeNull();
  });

  test('rejects an impossible day-of-month (Feb 30 → would roll into March)', () => {
    expect(buildLocalDate(2024, 2, 30)).toBeNull();
  });

  test('rejects a zero / out-of-range month', () => {
    expect(buildLocalDate(2024, 0, 15)).toBeNull();
  });

  test('accepts a real leap day but rejects the non-leap-year Feb 29', () => {
    expect(buildLocalDate(2024, 2, 29)).not.toBeNull(); // 2024 is a leap year
    expect(buildLocalDate(2023, 2, 29)).toBeNull(); // 2023 is not → would roll to Mar 1
  });
});
