/**
 * Source guard: validateEntityOwnership must delegate to shared seams, not a local copy or an inlined
 * repository check. Vehicle and insurance policy use the strict validators. Expenses and odometer
 * entries are owner-stamped on shared vehicles, so they must use requireVehicleWrite instead of a
 * userId match.
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
    const localDecl =
      /(?:function|const|let)\s+(validateVehicleOwnership|validateInsuranceOwnership|requireVehicleWrite)\b/;
    const m = localDecl.exec(src);
    expect(
      m,
      `photos/helpers.ts re-declares a shared ownership validator locally ` +
        `(${m?.[1]}). Import it from utils/validation.ts instead.`
    ).toBeNull();
  });

  test('does NOT re-import vehicle/policy repositories to inline ownership checks', () => {
    const src = readHelpers();
    for (const repo of ['vehicleRepository', 'insurancePolicyRepository']) {
      expect(
        src.includes(repo),
        `photos/helpers.ts references ${repo} again — vehicle/policy ownership should go ` +
          `through the shared validator, not an inlined repository query.`
      ).toBe(false);
    }
  });
});
