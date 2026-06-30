/**
 * C239 source-scan guard — FuelStatsTab's four-state empty-data gate.
 *
 * A C239 eyes-on scout (booted + shot /analytics desktop+mobile on the seeded user, whose fillups are all
 * 2024 while the env clock is 2026, so the default this-year range is genuinely empty) CERTIFIED the tab
 * renders the "No fuel data yet" EmptyState — NOT ~10 zero/N-A stat cards or a broken/NaN chart — when
 * there's no in-range fuel data. That correct render hinges on TWO load-bearing pieces of the component:
 *   1. a `hasFuelData` derivation (any fillup in the year buckets OR any recorded distance), and
 *   2. a `{:else if ...!hasFuelData}` branch that returns a single EmptyState BEFORE the stat-grid branch.
 * Both are inline in the `.svelte` (no component-test harness for analytics here), so a refactor could drop
 * the gate and silently regress to the ~10-N/A-cards wall the gate exists to prevent (its own comment) with
 * NOTHING going red. This source-scan pins the contract: the gate + its conservative OR-of-three condition
 * must survive. The C190/C170 cross-file source-scan idiom. (NOT a component render test — a structural pin.)
 */

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const CWD = process.cwd();
const SRC = readFileSync(`${CWD}/src/lib/components/analytics/fuel/FuelStatsTab.svelte`, 'utf8');

describe('FuelStatsTab keeps its empty-data four-state gate (C239 guard)', () => {
  test('derives hasFuelData (the empty-vs-grid decision)', () => {
    expect(SRC).toMatch(/hasFuelData\s*=\s*\$derived/);
  });

  test('hasFuelData stays CONSERVATIVE — any fillup year-bucket OR recorded distance shows the grid', () => {
    // The OR-of-three (never hide real data): currentYear fillups, previousYear fillups, or totalDistance.
    expect(SRC).toMatch(/fillups\.currentYear\s*>\s*0/);
    expect(SRC).toMatch(/fillups\.previousYear\s*>\s*0/);
    expect(SRC).toMatch(/distance\.totalDistance\s*>\s*0/);
  });

  test('gates the EmptyState on !hasFuelData (so empty data shows one empty state, not ~10 N/A cards)', () => {
    // The branch that renders the empty state must key off hasFuelData being false.
    expect(SRC).toMatch(/!hasFuelData/);
    expect(SRC).toContain('No fuel data yet');
  });

  test('renders the full four-state set (loading / error+Retry / empty / data)', () => {
    expect(SRC).toContain('isLoading'); // loading branch
    expect(SRC).toMatch(/:else if error/); // error branch
    expect(SRC).toContain('EmptyState'); // empty branch
    expect(SRC).toContain('Retry'); // error branch is recoverable
  });
});
