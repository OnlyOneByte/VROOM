/**
 * Source guard: photo entity-ownership must delegate to the shared seams in utils/validation.ts and
 * utils/sharing.ts, not a local copy or an inlined repository query. The behavior of each leg (strict
 * vehicle and policy checks, editor access to owner-stamped expenses and odometer readings) is
 * covered over HTTP by shared-entity-photo-access.test.ts and entity-ownership-gate.test.ts, so this
 * file only pins the structure that behavior cannot see.
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

  test('routes vehicle and insurance_policy through the strict shared validators', () => {
    const src = readHelpers();
    for (const fn of ['validateVehicleOwnership', 'validateInsuranceOwnership']) {
      expect(
        new RegExp(`\\b${fn}\\s*\\(`).test(src),
        `validateEntityOwnership must call the shared ${fn} from utils/validation.ts.`
      ).toBe(true);
    }
  });

  test('the owner-stamped legs authorize through the vehicle-sharing seam', () => {
    expect(
      /\brequireVehicleWrite\s*\(/.test(readHelpers()),
      'the expense and odometer_entry legs must authorize via requireVehicleWrite (utils/sharing.ts). ' +
        'A userId-match check there denies an accepted editor the photo on their own owner-stamped row.'
    ).toBe(true);
  });

  test('does NOT locally re-declare a shared ownership validator (no shadowing duplicate)', () => {
    const localDecl =
      /\b(?:function|const|let)\s+(validateVehicleOwnership|validateInsuranceOwnership|requireVehicleWrite)\b/;
    const match = localDecl.exec(readHelpers());
    expect(
      match,
      `photos/helpers.ts re-declares a shared ownership validator locally ` +
        `(${match?.[1]}). Import it from its shared module instead.`
    ).toBeNull();
  });

  test('does NOT re-import vehicle or policy repositories to inline ownership checks', () => {
    const src = readHelpers();
    for (const repo of ['vehicleRepository', 'insurancePolicyRepository']) {
      expect(
        new RegExp(`\\b${repo}\\b`).test(src),
        `photos/helpers.ts references ${repo} again. Ownership should go through the shared validator, ` +
          `not an inlined repository query.`
      ).toBe(false);
    }
  });
});
