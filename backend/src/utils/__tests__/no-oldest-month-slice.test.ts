/**
 * Regression GUARD (committed, travels with the merge) for the cycle-11 bug class:
 * truncating a month-keyed series to the OLDEST N months instead of the most recent.
 *
 * The monthly chart builders sort their entries by month key ascending
 * (`.sort(([a], [b]) => a.localeCompare(b))`) and then keep a window. The CORRECT window is
 * `.slice(-N)` (most recent N); `.slice(0, N)` keeps the OLDEST N and hides the current
 * period once a user has more than N months of data — exactly the cycle-11 bug in
 * buildMonthlyConsumption (and its latent copy in buildConvertedEfficiencyTrend).
 *
 * This scans the analytics source for the precise antipattern: a localeCompare month-sort
 * chained (within the same statement — no `;` between) into `.slice(0, …)`. It deliberately
 * does NOT flag `.slice(0, N)` after a NUMERIC sort (e.g. the maintenance timeline's
 * `.sort((a, b) => a.daysRemaining - b.daysRemaining).slice(0, 50)`, which correctly takes the
 * most-urgent items), because that chain has no `localeCompare`.
 *
 * Pure source scan — no DB, no network. Runs in the fast suite.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// Backend analytics lives at src/utils/analytics-charts.ts and src/api/analytics/repository.ts.
const SRC = join(HERE, '..', '..');
const FILES = [
  join(SRC, 'utils', 'analytics-charts.ts'),
  join(SRC, 'api', 'analytics', 'repository.ts'),
];

// A month-key ascending sort chained into slice(0, …) WITHIN ONE statement. `[^;]*?` stays
// inside the chain (a `;` ends the statement), so a later unrelated slice(0,) won't match,
// and a numeric `.sort(...).slice(0, N)` (no localeCompare) is never flagged.
const OLDEST_MONTH_SLICE = /localeCompare[^;]*?\.slice\(\s*0\s*,/;

describe('no oldest-month slice in analytics month series (cycle 11 class guard)', () => {
  test('the scan resolves real source files (guard is live, not a no-op)', () => {
    for (const f of FILES) {
      expect(readFileSync(f, 'utf8').length, `unreadable/empty: ${f}`).toBeGreaterThan(100);
    }
  });

  test('no month-key sort is truncated with slice(0, N) — use slice(-N) for the recent window', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      // Collapse whitespace so a multi-line `.sort(...).slice(...)` chain is matched as one.
      const collapsed = readFileSync(f, 'utf8').replace(/\s+/g, ' ');
      if (OLDEST_MONTH_SLICE.test(collapsed)) {
        offenders.push(f.replace(`${SRC}/`, ''));
      }
    }
    expect(
      offenders,
      `A month-key (localeCompare) sort is sliced from the START — that keeps the OLDEST months ` +
        `and hides the current period (cycle 11). Use .slice(-N) for the most-recent window:\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
