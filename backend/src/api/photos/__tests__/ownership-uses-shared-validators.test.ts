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
    expect(
      /\brequireVehicleAccess\s*\(\s*entityId\s*,\s*userId\s*,\s*'owner'\s*\)/.test(src),
      "the vehicle leg must call requireVehicleAccess(entityId, userId, 'owner') from utils/vehicle-access.ts."
    ).toBe(true);
    expect(
      /\bvalidateInsuranceOwnership\s*\(/.test(src),
      'validateEntityOwnership must call the shared validateInsuranceOwnership from utils/validation.ts.'
    ).toBe(true);
  });

  test('the owner-stamped legs authorize through the vehicle write gate', () => {
    const writeGates = readHelpers().match(/\brequireVehicleAccess\s*\([^)]*'write'\s*\)/g) ?? [];
    expect(
      writeGates.length,
      "the expense and odometer_entry legs must authorize via requireVehicleAccess(…, 'write'). " +
        'A userId-match check there denies an accepted editor the photo on their own owner-stamped row.'
    ).toBe(2);
  });

  test('does NOT locally re-declare a shared ownership validator (no shadowing duplicate)', () => {
    const localDecl =
      /\b(?:function|const|let)\s+(requireVehicleAccess|resolveVehicleAccess|validateInsuranceOwnership)\b/;
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
