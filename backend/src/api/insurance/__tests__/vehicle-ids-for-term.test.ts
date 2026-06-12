/**
 * Unit tests for vehicleIdsForTerm — the pure junction→vehicleIds derivation extracted (C273) from the
 * three byte-identical sites in insurance/routes.ts (create-policy loop, addTerm, updateTerm). Pins the
 * behavior the dedup must preserve: filter the policy's termVehicleCoverage to one termId, project the
 * vehicleId, preserving order and NOT de-duplicating (each call site fed the result straight to
 * createTermExpenses/updateTermExpenses, which dedup downstream — so this helper is a faithful 1:1 map).
 */

import { describe, expect, test } from 'bun:test';
import { vehicleIdsForTerm } from '../hooks';
import type { TermCoverageRow } from '../repository';

const COVERAGE: TermCoverageRow[] = [
  { termId: 't1', vehicleId: 'v-a' },
  { termId: 't1', vehicleId: 'v-b' },
  { termId: 't2', vehicleId: 'v-c' },
];

describe('vehicleIdsForTerm', () => {
  test('returns only the vehicleIds for the requested term, in order', () => {
    expect(vehicleIdsForTerm(COVERAGE, 't1')).toEqual(['v-a', 'v-b']);
    expect(vehicleIdsForTerm(COVERAGE, 't2')).toEqual(['v-c']);
  });

  test('returns [] for a term with no coverage rows (or an unknown term)', () => {
    expect(vehicleIdsForTerm(COVERAGE, 'nope')).toEqual([]);
    expect(vehicleIdsForTerm([], 't1')).toEqual([]);
  });

  test('does not cross terms — a vehicle on another term never leaks in', () => {
    const result = vehicleIdsForTerm(COVERAGE, 't1');
    expect(result).not.toContain('v-c');
  });
});
