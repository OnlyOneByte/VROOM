import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { TRIP_PURPOSES } from '../../api/trips/validation';
import type { Trip } from '../../db/schema';
import { buildTripSummary } from '../trip-summary';

let idc = 0;
function trip(over: Partial<Trip> = {}): Trip {
  idc++;
  return {
    id: `t${idc}`,
    vehicleId: 'v1',
    userId: 'u1',
    startOdometer: 1000,
    endOdometer: 1080,
    purpose: 'business',
    tripDate: new Date('2024-06-20T12:00:00.000Z'),
    startLocation: null,
    endLocation: null,
    note: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as Trip;
}

describe('buildTripSummary', () => {
  test('empty trips → all zeros, never NaN', () => {
    const s = buildTripSummary([], 0.67);
    expect(s.tripCount).toBe(0);
    expect(s.totalDistance).toBe(0);
    expect(s.averageTripDistance).toBe(0);
    expect(s.businessDistance).toBe(0);
    expect(s.businessMileageValue).toBe(0);
    for (const p of TRIP_PURPOSES) expect(s.distanceByPurpose[p]).toBe(0);
    expect(Number.isNaN(s.averageTripDistance)).toBe(false);
  });

  test('every purpose key is present even when no trips of that purpose', () => {
    const s = buildTripSummary([trip({ purpose: 'business' })]);
    expect(Object.keys(s.distanceByPurpose).sort()).toEqual([...TRIP_PURPOSES].sort());
  });

  test('totalDistance + per-purpose split + business-$ are correct for a mixed set', () => {
    const trips = [
      trip({ startOdometer: 1000, endOdometer: 1100, purpose: 'business' }),
      trip({ startOdometer: 2000, endOdometer: 2050, purpose: 'business' }),
      trip({ startOdometer: 3000, endOdometer: 3030, purpose: 'personal' }),
      trip({ startOdometer: 4000, endOdometer: 4020, purpose: 'commute' }),
    ];
    const s = buildTripSummary(trips, 0.67);
    expect(s.tripCount).toBe(4);
    expect(s.totalDistance).toBe(200);
    expect(s.distanceByPurpose.business).toBe(150);
    expect(s.distanceByPurpose.personal).toBe(30);
    expect(s.distanceByPurpose.commute).toBe(20);
    expect(s.distanceByPurpose.other).toBe(0);
    expect(s.averageTripDistance).toBe(50);
    expect(s.businessDistance).toBe(150);
    expect(s.businessMileageValue).toBeCloseTo(100.5, 5);
    expect(s.rate).toBe(0.67);
  });

  test('an inverted odometer pair contributes 0 miles', () => {
    const s = buildTripSummary([
      trip({ startOdometer: 5000, endOdometer: 4000, purpose: 'business' }),
    ]);
    expect(s.totalDistance).toBe(0);
    expect(s.distanceByPurpose.business).toBe(0);
  });

  test('an unexpected purpose buckets under "other" (no crash, no dropped miles)', () => {
    const s = buildTripSummary([
      trip({ startOdometer: 0, endOdometer: 42, purpose: 'joyride' as never }),
    ]);
    expect(s.totalDistance).toBe(42);
    expect(s.distanceByPurpose.other).toBe(42);
  });

  test('rate defaults to 0, so businessMileageValue is 0', () => {
    const s = buildTripSummary([trip({ startOdometer: 0, endOdometer: 100, purpose: 'business' })]);
    expect(s.businessDistance).toBe(100);
    expect(s.businessMileageValue).toBe(0);
  });

  test('property: Σ distanceByPurpose == totalDistance AND businessMileageValue == businessDistance × rate', () => {
    const tripArb = fc.record({
      start: fc.integer({ min: 0, max: 1_000_000 }),
      delta: fc.integer({ min: -5000, max: 5000 }),
      purpose: fc.constantFrom(...TRIP_PURPOSES, 'unknown'),
    });
    fc.assert(
      fc.property(fc.array(tripArb), fc.float({ min: 0, max: 10, noNaN: true }), (rows, rate) => {
        const trips = rows.map((r) =>
          trip({
            startOdometer: r.start,
            endOdometer: r.start + r.delta,
            purpose: r.purpose as never,
          })
        );
        const s = buildTripSummary(trips, rate);
        const sumByPurpose = TRIP_PURPOSES.reduce((acc, p) => acc + s.distanceByPurpose[p], 0);
        expect(sumByPurpose).toBe(s.totalDistance);
        expect(s.businessMileageValue).toBeCloseTo(s.businessDistance * rate, 5);
        expect(Number.isNaN(s.averageTripDistance)).toBe(false);
      })
    );
  });
});
