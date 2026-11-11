import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', 'repository.ts');

const CONVERT_CALL = /\.(?:computeConverted\w+|buildConverted\w+)\(([^;]*)\)\s*;/g;
const PLACEHOLDERS = [/new Map\(\)/, /DEFAULT_UNIT_PREFERENCES/, /,\s*true\s*$/];

describe('no unconverted fleet pooling — convert helpers get REAL units, never placeholders', () => {
  test('the scan resolves the real analytics repository', () => {
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
        `conversion → a mixed mi+km/gal+L fleet pools raw. Pass the real ` +
        `vehicleUnitsMap + userUnits + skipConversion=allVehiclesMatchUnits(...):\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  test('the scan finds the real convert-call sites', () => {
    const collapsed = readFileSync(REPO, 'utf8').replace(/\s+/g, ' ');
    const calls = [...collapsed.matchAll(CONVERT_CALL)];
    expect(
      calls.length,
      'expected ≥3 convert-helper call sites in the analytics repository'
    ).toBeGreaterThanOrEqual(3);
  });
});
