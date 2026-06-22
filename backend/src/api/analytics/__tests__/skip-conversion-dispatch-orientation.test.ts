/**
 * Regression GUARD (committed, travels with the merge) for the #94 convert-before-pool DISPATCH orientation
 * (the C65/C69/C72 advanced-builder twins).
 *
 * getSummary / getFuelStats / getFuelAdvanced / getCrossVehicle each pick between a PURE builder and its
 * `buildConverted*` twin on the `skipConversion` flag (skipConversion = allVehiclesMatchUnits(...)). The
 * orientation is load-bearing and easy to silently invert:
 *
 *     skipConversion ? <pure builder>          : this.buildConverted<X>(...)   // ternary form
 *     if (skipConversion) { x = <pure> } else  { x = this.buildConverted<X>(...) }   // if/else form
 *
 * skipConversion=TRUE means "all vehicles already share the user's units → NO conversion needed → take the
 * PURE builder". So the TRUTHY branch must be the pure builder and the FALSY/else branch the converted twin.
 * Flip it (`skipConversion ? converted : pure`, or `if (!skipConversion)`) and a MIXED-unit fleet takes the
 * raw-pooling pure builder → #94 regression (mi/gal pooled with km/L, gal with L) — INVISIBLE to a same-unit
 * test fixture (the only kind most builder tests use), which is exactly why a behavioral test can't catch it.
 *
 * The C59 source-scan pins that the converted call never gets a unit PLACEHOLDER; this pins the complementary
 * invariant — that the converted twin is on the CONVERSION-NEEDED branch, not the skip branch. Together they
 * fence the whole dispatch. The one-edit→source-scan pattern (C25/C45/C59) on the C65/C69/C72 dispatch sites.
 *
 * Pure source scan — no DB, no network. Runs in the fast suite.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', 'repository.ts');

// Ternary dispatch: `skipConversion ? <truthy> : <falsy>`. The truthy branch runs from `?` to the `:`
// (`[^:?]` keeps it inside ONE ternary — can't cross another `?`/`:`). The falsy branch matches EITHER a
// method call (`this.X(...)`) OR a bare module-function call (`X(...)`) so an INVERTED ternary (converted on
// the truthy side, pure on the falsy) still MATCHES here and trips the orientation assertion below with the
// right diagnostic — rather than silently dropping out of the match set. `\([^;]*?\)` is non-greedy but the
// builder calls have no nested parens, so it captures the full single arg list.
const TERNARY = /skipConversion\s*\?\s*([^:?]*?)\s*:\s*((?:this\.)?\w+\([^;]*?\))/g;

// If/else dispatch: `if (skipConversion) { <then> } else { <else> }`. Captures the two block bodies.
const IF_ELSE = /if\s*\(\s*skipConversion\s*\)\s*\{([^}]*)\}\s*else\s*\{([^}]*)\}/g;

function hasConverted(s: string): boolean {
  return /buildConverted/.test(s);
}

describe('#94 skipConversion dispatch orientation — truthy branch is the PURE builder, falsy is the converted twin', () => {
  test('the scan resolves the real analytics repository (guard is live, not a no-op)', () => {
    expect(readFileSync(REPO, 'utf8').length, `unreadable/empty: ${REPO}`).toBeGreaterThan(100);
  });

  test('every `skipConversion ? a : b` ternary puts the converted twin on the FALSY branch only', () => {
    const collapsed = readFileSync(REPO, 'utf8').replace(/\s+/g, ' ');
    // A DISPATCH ternary is one where some branch names a buildConverted* twin. This EXCLUDES the
    // per-point `skipConversion ? point.efficiency : convertEfficiency(...)` ternary inside the
    // convertedGasEfficiencyPoints generator (a value convert, not a builder dispatch — neither branch
    // mentions buildConverted), which is not what this guard governs.
    const matches = [...collapsed.matchAll(TERNARY)].filter(
      (m) => hasConverted(m[1] ?? '') || hasConverted(m[2] ?? '')
    );
    expect(
      matches.length,
      'expected ≥3 skipConversion builder-dispatch ternary sites (C65/C69/C72)'
    ).toBeGreaterThanOrEqual(3);

    const inverted: string[] = [];
    for (const m of matches) {
      const truthy = m[1] ?? '';
      const falsy = m[2] ?? '';
      // Correct: truthy = pure (NO buildConverted), falsy = the converted twin.
      if (hasConverted(truthy) || !hasConverted(falsy)) {
        inverted.push(m[0].slice(0, 140));
      }
    }
    expect(
      inverted,
      `A skipConversion ternary is INVERTED — the converted twin must be on the FALSY (conversion-needed) ` +
        `branch and the pure builder on the TRUTHY (skip) branch. Flipping it routes a mixed-unit fleet to ` +
        `the raw-pooling pure builder (#94, NORTH_STAR #2), invisible to same-unit tests:\n${inverted.join('\n')}`
    ).toEqual([]);
  });

  test('every `if (skipConversion) {…} else {…}` dispatch puts the converted twin in the ELSE block only', () => {
    const collapsed = readFileSync(REPO, 'utf8').replace(/\s+/g, ' ');
    const matches = [...collapsed.matchAll(IF_ELSE)].filter(
      (m) => hasConverted(m[1] ?? '') || hasConverted(m[2] ?? '')
    );
    // At least the cross-vehicle fuelEfficiencyComparison dispatch.
    expect(
      matches.length,
      'expected ≥1 skipConversion if/else convert dispatch site'
    ).toBeGreaterThanOrEqual(1);

    const inverted: string[] = [];
    for (const m of matches) {
      const thenBlock = m[1] ?? '';
      const elseBlock = m[2] ?? '';
      // Correct: then = pure (NO buildConverted), else = the converted twin.
      if (hasConverted(thenBlock) || !hasConverted(elseBlock)) {
        inverted.push(m[0].slice(0, 160));
      }
    }
    expect(
      inverted,
      `An if (skipConversion) convert-dispatch is INVERTED — the converted twin must be in the ELSE ` +
        `(conversion-needed) block, the pure builder in the THEN (skip) block. Flipping it pools a mixed ` +
        `fleet raw (#94):\n${inverted.join('\n')}`
    ).toEqual([]);
  });
});
