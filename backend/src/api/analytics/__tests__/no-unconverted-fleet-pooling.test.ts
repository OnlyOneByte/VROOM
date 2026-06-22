/**
 * Regression GUARD (committed, travels with the merge) for the #94 fleet-unit-pooling class (distance
 * member fixed C58).
 *
 * The fleet-wide analytics SUMMARY readers (getQuickStats / getYearEnd / getSummary / getFuelStats) pool
 * per-vehicle quantities. To be correct for a MIXED-unit fleet (mi+km / gal+L), each vehicle's value must
 * be converted to the user's global units BEFORE pooling — the `computeConvertedTotalDistance` /
 * `computeConvertedEfficiencyValues` / `buildConvertedEfficiencyTrend` helpers do this, gated by a
 * `skipConversion = allVehiclesMatchUnits(...)` flag. Pre-C58, getFuelStats DEFEATED the conversion by
 * passing NO-OP PLACEHOLDERS — `new Map()` (empty unit map), `DEFAULT_UNIT_PREFERENCES`, and a hardcoded
 * `skipConversion = true` — so a mixed mi+km fleet pooled miles with kilometres (NORTH_STAR #2). The C58
 * fix threads the REAL units (vehicleUnitsMap, userUnits, the computed skipConversion variable).
 *
 * The C58 behavioral test (fuel-stats-fleet-distance-pooling.test.ts) proves the CURRENT getFuelStats path
 * converts a mixed fleet, but it only drives that one reader's distance scalar. This SOURCE SCAN is the
 * tree-wide net: it pins that NO `computeConverted*` / `buildConverted*` call reintroduces the placeholder
 * triple — so a future reader (or a refactor) that hardcodes `new Map()` / `DEFAULT_UNIT_PREFERENCES` /
 * `skipConversion: true` regresses RED here even if its same-unit tests stay green (the bug is invisible to
 * a same-unit fixture). Source-scan > untracked e2e for merge survival (GUIDE); the one-edit-fix→source-scan
 * pattern again (C24→C25 #36, C44→C45 #37, C54 import-date — now C58→C59 for #94).
 *
 * Pure source scan — no DB, no network. Runs in the fast suite.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// The analytics repository is the only module that calls the per-vehicle convert-then-pool helpers.
const REPO = join(HERE, '..', 'repository.ts');

// Match a convert-helper CALL's full argument list, up to the statement-terminating `);`. The capture is
// GREEDY within the statement (`[^;]*`) so a nested `new Map()` inside the args doesn't truncate it at the
// first `)` (a non-greedy match would stop there and miss the placeholder). `[^;]` can't cross a `;`, so it
// stays inside the one call statement. A placeholder DEFEATS the per-vehicle conversion: an empty
// `new Map()` unit map, a `DEFAULT_UNIT_PREFERENCES` target, or a hardcoded `true` skipConversion. The
// legit calls pass the variables `vehicleUnitsMap, userUnits, skipConversion`, so none match.
const CONVERT_CALL = /\.(?:computeConverted\w+|buildConverted\w+)\(([^;]*)\)\s*;/g;
const PLACEHOLDERS = [/new Map\(\)/, /DEFAULT_UNIT_PREFERENCES/, /,\s*true\s*$/];

describe('no unconverted fleet pooling — convert helpers get REAL units, never placeholders (#94 class guard)', () => {
  test('the scan resolves the real analytics repository (guard is live, not a no-op)', () => {
    expect(readFileSync(REPO, 'utf8').length, `unreadable/empty: ${REPO}`).toBeGreaterThan(100);
  });

  test('no computeConverted*/buildConverted* call passes a unit placeholder (new Map / DEFAULT / hardcoded skipConversion=true)', () => {
    const collapsed = readFileSync(REPO, 'utf8').replace(/\s+/g, ' ');
    const offenders: string[] = [];
    for (const m of collapsed.matchAll(CONVERT_CALL)) {
      const args = m[1] ?? '';
      if (PLACEHOLDERS.some((p) => p.test(args.trim()))) {
        offenders.push(m[0].slice(0, 120));
      }
    }
    expect(
      offenders,
      `A fleet-summary convert-then-pool helper is called with a unit PLACEHOLDER (new Map() / ` +
        `DEFAULT_UNIT_PREFERENCES / hardcoded skipConversion=true), which defeats the per-vehicle ` +
        `conversion → a mixed mi+km/gal+L fleet pools raw (#94, NORTH_STAR #2). Pass the real ` +
        `vehicleUnitsMap + userUnits + skipConversion=allVehiclesMatchUnits(...):\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  test('the guard is non-vacuous — it DOES find the real convert-call sites', () => {
    const collapsed = readFileSync(REPO, 'utf8').replace(/\s+/g, ' ');
    const calls = [...collapsed.matchAll(CONVERT_CALL)];
    // There are several summary readers; if the regex matched nothing the scan would vacuously pass.
    expect(
      calls.length,
      'expected ≥3 convert-helper call sites in the analytics repository'
    ).toBeGreaterThanOrEqual(3);
  });
});
