/**
 * Unit tests for vehicleIdsForTerm. It preserves order and does not de-duplicate, and it never returns
 * vehicles from another term.
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

  test('does not cross terms', () => {
    const result = vehicleIdsForTerm(COVERAGE, 't1');
    expect(result).not.toContain('v-c');
  });
});
