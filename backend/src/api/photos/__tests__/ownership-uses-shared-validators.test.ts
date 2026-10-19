/**
 * Regression GUARD: `photos/helpers.ts validateEntityOwnership` must express each entity's
 * authorization rule by calling a SHARED seam — never a private copy or an inlined repository
 * check. Two implementations of one authorization rule drift independently: one gets a security
 * fix, the other does not.
 *
 * This file once carried a private `validateExpenseOwnership` plus inlined
 * `vehicleRepository.findByUserIdAndId` / `insurancePolicyRepository.findById` checks that
 * duplicated the shared validators. Which seam each entity belongs to is itself load-bearing:
 *  - `vehicle` / `insurance_policy` own via their own userId column → the STRICT validators in
 *  utils/validation.ts.
 *  - `expense` / `odometer_entry` are OWNER-STAMPED on a shared vehicle (the row carries the
 *  vehicle owner's userId, not the editor's), so a strict acting-user match denies an accepted
 *  editor the photo on a row they authored → the vehicle-sharing seam, `requireVehicleWrite`.
 *  Reverting either to a userId-match check brings back a 404 on the editor's own receipt.
 *
 * It deliberately does NOT touch `insurance_claim` (transitive claim→policy ownership via
 * insuranceClaimRepository, no shared validator exists) nor `validatePhotoOwnership` (a different
 * check, on an existing photo row).
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

describe('photo entity-ownership uses the shared validators', () => {
  test('the scan resolves the real source file (guard is live, not a no-op)', () => {
    expect(readHelpers().length, `unreadable/empty: ${HELPERS}`).toBeGreaterThan(200);
  });

  test('routes vehicle / insurance_policy through the strict shared validators', () => {
    const src = readHelpers();
    for (const fn of ['validateVehicleOwnership', 'validateInsuranceOwnership']) {
      expect(
        src.includes(`${fn}(`),
        `validateEntityOwnership must call the shared ${fn} from utils/validation.ts. ` +
          `Missing call site.`
      ).toBe(true);
    }
  });

  test('routes the owner-stamped entities through the vehicle-sharing seam', () => {
    const src = readHelpers();
    expect(
      src.includes('requireVehicleWrite('),
      'the expense and odometer_entry legs must authorize via requireVehicleWrite (utils/sharing.ts). ' +
        'A userId-match check there denies an accepted editor the photo on their own owner-stamped row.'
    ).toBe(true);
    // Two call sites, one per owner-stamped entity type — not one leg quietly left behind.
    expect(src.match(/requireVehicleWrite\(/g)?.length).toBe(2);
  });

  test('does NOT locally re-declare a shared ownership validator (no shadowing duplicate)', () => {
    const src = readHelpers();
    // The shared validators are IMPORTED; a local `function`/`const` of the same name
    // would be a re-introduced private copy that can drift from its source of truth.
    const localDecl =
      /(?:function|const|let)\s+(validateVehicleOwnership|validateInsuranceOwnership|requireVehicleWrite)\b/;
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
    // These imports were dropped in — their return marks a re-inlined vehicle/policy
    // ownership check (the old `vehicleRepository.findByUserIdAndId` / `insurancePolicyRepository
    // .findById` pattern) instead of delegating to the shared validator.
    for (const repo of ['vehicleRepository', 'insurancePolicyRepository']) {
      expect(
        src.includes(repo),
        `photos/helpers.ts references ${repo} again — vehicle/policy ownership should go ` +
          `through the shared validator, not an inlined repository query.`
      ).toBe(false);
    }
  });
});
