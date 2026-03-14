/**
 * Property-Based Tests for unit-conversions.ts
 *
 * Property 5: Unit conversion correctness
 * Property 6: Unit conversion identity
 * Property 7: Unit conversion round-trip
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { DistanceUnit, VolumeUnit } from '../../types';
import { convertDistance, convertEfficiency, convertVolume } from '../unit-conversions';

// ── Conversion factors (exact values from design doc) ──────────────────────────

const MILES_TO_KM = 1.609344;
const GALLONS_US_TO_LITERS = 3.785411784;
const GALLONS_UK_TO_LITERS = 4.54609;

// ── Generators ─────────────────────────────────────────────────────────────────

const numericValueArb = fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true });
const positiveValueArb = fc.double({ min: 0.001, max: 1e6, noNaN: true, noDefaultInfinity: true });

const distanceUnitArb = fc.constantFrom(DistanceUnit.MILES, DistanceUnit.KILOMETERS);
const volumeUnitArb = fc.constantFrom(
  VolumeUnit.GALLONS_US,
  VolumeUnit.GALLONS_UK,
  VolumeUnit.LITERS
);

const distancePairArb = fc.tuple(distanceUnitArb, distanceUnitArb).filter(([a, b]) => a !== b);
const volumePairArb = fc.tuple(volumeUnitArb, volumeUnitArb).filter(([a, b]) => a !== b);

// ── Reference helpers ──────────────────────────────────────────────────────────

/** Expected distance conversion factor for a given (from, to) pair. */
function expectedDistanceFactor(from: DistanceUnit, to: DistanceUnit): number {
  if (from === to) return 1;
  if (from === DistanceUnit.MILES && to === DistanceUnit.KILOMETERS) return MILES_TO_KM;
  return 1 / MILES_TO_KM;
}

/** Expected volume conversion factor via normalize-to-liters. */
function expectedVolumeFactor(from: VolumeUnit, to: VolumeUnit): number {
  if (from === to) return 1;
  const toLiters: Record<VolumeUnit, number> = {
    [VolumeUnit.GALLONS_US]: GALLONS_US_TO_LITERS,
    [VolumeUnit.GALLONS_UK]: GALLONS_UK_TO_LITERS,
    [VolumeUnit.LITERS]: 1,
  };
  return toLiters[from] / toLiters[to];
}

// ── Property 5: Unit conversion correctness ────────────────────────────────────
// Feature: unit-aware-display, Property 5: Unit conversion correctness
// **Validates: Requirements 3.1, 3.2, 3.3**

describe('Property 5: Unit conversion correctness', () => {
  test('convertDistance applies the correct factor for all distance unit pairs', () => {
    fc.assert(
      fc.property(numericValueArb, distancePairArb, (value, [from, to]) => {
        const result = convertDistance(value, from, to);
        const expected = value * expectedDistanceFactor(from, to);
        expect(result).toBeCloseTo(expected, 5);
      }),
      { numRuns: 100 }
    );
  });

  test('convertVolume applies the correct factor for all volume unit pairs', () => {
    fc.assert(
      fc.property(numericValueArb, volumePairArb, (value, [from, to]) => {
        const result = convertVolume(value, from, to);
        const expected = value * expectedVolumeFactor(from, to);
        expect(result).toBeCloseTo(expected, 5);
      }),
      { numRuns: 100 }
    );
  });

  test('convertEfficiency applies distance and inverse volume factors', () => {
    fc.assert(
      fc.property(
        numericValueArb,
        distancePairArb,
        volumePairArb,
        (value, [fromDist, toDist], [fromVol, toVol]) => {
          const result = convertEfficiency(value, fromDist, fromVol, toDist, toVol);
          const distFactor = expectedDistanceFactor(fromDist, toDist);
          const volFactor = expectedVolumeFactor(fromVol, toVol);
          const expected = (value * distFactor) / volFactor;
          expect(result).toBeCloseTo(expected, 5);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ── Property 6: Unit conversion identity ───────────────────────────────────────
// Feature: unit-aware-display, Property 6: Unit conversion identity
// **Validates: Requirements 3.4**

describe('Property 6: Unit conversion identity', () => {
  test('convertDistance returns exact input when from === to', () => {
    fc.assert(
      fc.property(numericValueArb, distanceUnitArb, (value, unit) => {
        const result = convertDistance(value, unit, unit);
        expect(result).toBe(value);
      }),
      { numRuns: 100 }
    );
  });

  test('convertVolume returns exact input when from === to', () => {
    fc.assert(
      fc.property(numericValueArb, volumeUnitArb, (value, unit) => {
        const result = convertVolume(value, unit, unit);
        expect(result).toBe(value);
      }),
      { numRuns: 100 }
    );
  });

  test('convertEfficiency returns exact input when all units match', () => {
    fc.assert(
      fc.property(numericValueArb, distanceUnitArb, volumeUnitArb, (value, distUnit, volUnit) => {
        const result = convertEfficiency(value, distUnit, volUnit, distUnit, volUnit);
        expect(result).toBe(value);
      }),
      { numRuns: 100 }
    );
  });
});

// ── Property 7: Unit conversion round-trip ─────────────────────────────────────
// Feature: unit-aware-display, Property 7: Unit conversion round-trip
// **Validates: Requirements 3.5**

describe('Property 7: Unit conversion round-trip', () => {
  test('distance round-trip A→B→A is within 0.0001 of original', () => {
    fc.assert(
      fc.property(positiveValueArb, distancePairArb, (value, [from, to]) => {
        const converted = convertDistance(value, from, to);
        const roundTripped = convertDistance(converted, to, from);
        expect(Math.abs(roundTripped - value)).toBeLessThan(0.0001);
      }),
      { numRuns: 100 }
    );
  });

  test('volume round-trip A→B→A is within 0.0001 of original', () => {
    fc.assert(
      fc.property(positiveValueArb, volumePairArb, (value, [from, to]) => {
        const converted = convertVolume(value, from, to);
        const roundTripped = convertVolume(converted, to, from);
        expect(Math.abs(roundTripped - value)).toBeLessThan(0.0001);
      }),
      { numRuns: 100 }
    );
  });

  test('efficiency round-trip A→B→A is within 0.0001 of original', () => {
    fc.assert(
      fc.property(
        positiveValueArb,
        distancePairArb,
        volumePairArb,
        (value, [fromDist, toDist], [fromVol, toVol]) => {
          const converted = convertEfficiency(value, fromDist, fromVol, toDist, toVol);
          const roundTripped = convertEfficiency(converted, toDist, toVol, fromDist, fromVol);
          expect(Math.abs(roundTripped - value)).toBeLessThan(0.0001);
        }
      ),
      { numRuns: 100 }
    );
  });
});
