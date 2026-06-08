/**
 * Regression GUARD (committed, travels with the merge) for the cycle-18 dedup:
 * `photos/helpers.ts validateEntityOwnership` must route the vehicle / expense /
 * insurance_policy cases through the SHARED exported validators in
 * `utils/validation.ts` — never a private copy or an inlined repository check.
 *
 * Before C18 this file carried a private `validateExpenseOwnership` plus inlined
 * `vehicleRepository.findByUserIdAndId` / `insurancePolicyRepository.findById`
 * ownership checks that duplicated the shared validators — two implementations of
 * the same authorization rule that could DRIFT independently (one gets a security
 * fix, the other doesn't). C18 collapsed them to one source of truth. This guard
 * fails if any of that duplication creeps back.
 *
 * It deliberately does NOT touch the genuinely-inline cases that have no shared
 * validator: `insurance_claim` (transitive claim→policy ownership via
 * insuranceClaimRepository) and `odometer_entry` (direct odometer_entries.user_id
 * check), nor `validatePhotoOwnership` (a different check on an existing photo row).
 *
 * Pure source scan — no DB, no network. Runs in the fast suite.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPERS = join(HERE, '..', 'helpers.ts');

function readHelpers(): string {
  return readFileSync(HELPERS, 'utf8');
}

describe('photo entity-ownership uses the shared validators (cycle 18 dedup guard)', () => {
  test('the scan resolves the real source file (guard is live, not a no-op)', () => {
    expect(readHelpers().length, `unreadable/empty: ${HELPERS}`).toBeGreaterThan(200);
  });

  test('routes vehicle / expense / insurance_policy through the shared validators', () => {
    const src = readHelpers();
    for (const fn of [
      'validateVehicleOwnership',
      'validateExpenseOwnership',
      'validateInsuranceOwnership',
    ]) {
      expect(
        src.includes(`${fn}(`),
        `validateEntityOwnership must call the shared ${fn} from utils/validation.ts ` +
          `(C18 single-source-of-truth dedup). Missing call site.`
      ).toBe(true);
    }
  });

  test('does NOT locally re-declare a shared ownership validator (no shadowing duplicate)', () => {
    const src = readHelpers();
    // The shared validators are IMPORTED; a local `function`/`const` of the same name
    // would be a re-introduced private copy that can drift from utils/validation.ts.
    const localDecl =
      /(?:function|const|let)\s+(validateVehicleOwnership|validateExpenseOwnership|validateInsuranceOwnership)\b/;
    const m = localDecl.exec(src);
    expect(
      m,
      `photos/helpers.ts re-declares a shared ownership validator locally ` +
        `(${m?.[1]}) — that's the cycle-18 duplication coming back. Import it from ` +
        `utils/validation.ts instead.`
    ).toBeNull();
  });

  test('does NOT re-import vehicle/policy repositories to inline ownership checks', () => {
    const src = readHelpers();
    // These imports were dropped in C18 — their return marks a re-inlined vehicle/policy
    // ownership check (the old `vehicleRepository.findByUserIdAndId` / `insurancePolicyRepository
    // .findById` pattern) instead of delegating to the shared validator.
    for (const repo of ['vehicleRepository', 'insurancePolicyRepository']) {
      expect(
        src.includes(repo),
        `photos/helpers.ts references ${repo} again — vehicle/policy ownership should go ` +
          `through the shared validator (C18), not an inlined repository query.`
      ).toBe(false);
    }
  });
});
