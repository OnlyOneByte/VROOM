import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { attributeDistance, type OdometerPoint, type TripSpan } from '../distance';

const DRIVERS = ['a', 'b', 'c', null] as const;
const driver = fc.constantFrom(...DRIVERS);
const EVERYTHING = { from: 0, to: Number.MAX_SAFE_INTEGER };

const sum = (totals: ReturnType<typeof attributeDistance>) =>
  [...totals.values()].reduce((n, row) => n + row.trips + row.estimated, 0);

const journey = fc
  .array(
    fc.record({ step: fc.integer({ min: 1, max: 500 }), driverId: driver, trip: fc.boolean() }),
    { minLength: 1, maxLength: 30 }
  )
  .map((legs) => {
    const points: OdometerPoint[] = [{ odometer: 1000, at: 0, driverId: null }];
    const trips: TripSpan[] = [];
    let odometer = 1000;
    legs.forEach((leg, i) => {
      const at = (i + 1) * 1000;
      if (leg.trip) {
        trips.push({ start: odometer, end: odometer + leg.step, at, driverId: leg.driverId });
      }
      odometer += leg.step;
      points.push({ odometer, at, driverId: leg.driverId });
    });
    return { points, trips, distance: odometer - 1000 };
  });

describe('attributeDistance', () => {
  test('trips plus estimated gaps account for every mile between the first and last reading, once', () => {
    fc.assert(
      fc.property(journey, ({ points, trips, distance }) => {
        expect(sum(attributeDistance(points, trips, EVERYTHING, true))).toBe(distance);
      })
    );
  });

  test('without estimates only trip distance is counted', () => {
    fc.assert(
      fc.property(journey, ({ points, trips }) => {
        const totals = attributeDistance(points, trips, EVERYTHING, false);
        const tripDistance = trips.reduce((n, t) => n + t.end - t.start, 0);
        expect(sum(totals)).toBe(tripDistance);
        for (const row of totals.values()) expect(row.estimated).toBe(0);
      })
    );
  });

  test('changing who drove moves distance between drivers but never changes the total', () => {
    fc.assert(
      fc.property(journey, driver, ({ points, trips }, other) => {
        const before = sum(attributeDistance(points, trips, EVERYTHING, true));
        const swapped = points.map((p) => ({ ...p, driverId: other }));
        expect(sum(attributeDistance(swapped, trips, EVERYTHING, true))).toBe(before);
      })
    );
  });

  test('no figure is ever negative, even with overlapping trips and readings out of order', () => {
    const point = fc.record({ odometer: fc.nat(10_000), at: fc.nat(100), driverId: driver });
    const span = fc
      .record({ a: fc.nat(10_000), b: fc.nat(10_000), at: fc.nat(100), driverId: driver })
      .map(({ a, b, at, driverId }) => ({
        start: Math.min(a, b),
        end: Math.max(a, b),
        at,
        driverId,
      }));
    fc.assert(
      fc.property(fc.array(point), fc.array(span), (points, trips) => {
        for (const row of attributeDistance(points, trips, { from: 20, to: 80 }, true).values()) {
          expect(row.trips).toBeGreaterThanOrEqual(0);
          expect(row.estimated).toBeGreaterThanOrEqual(0);
        }
      })
    );
  });

  test('a reading lower than an earlier one never counts the same distance twice', () => {
    const points: OdometerPoint[] = [1000, 2000, 1500, 2100].map((odometer, at) => ({
      odometer,
      at,
      driverId: 'a',
    }));
    expect(sum(attributeDistance(points, [], EVERYTHING, true))).toBe(1100);
  });

  test("a trip dated outside the period doesn't hide distance inside it", () => {
    const points: OdometerPoint[] = [
      { odometer: 1000, at: 1, driverId: 'a' },
      { odometer: 1500, at: 5, driverId: 'b' },
    ];
    const elsewhere: TripSpan[] = [{ start: 1100, end: 1400, at: 99, driverId: 'c' }];
    const totals = attributeDistance(points, elsewhere, { from: 0, to: 10 }, true);
    expect(totals.get('b')).toEqual({ trips: 0, estimated: 500 });
    expect(totals.has('c')).toBe(false);
  });

  test('a trip dated before the period still covers the gap it was driven in, so periods add up', () => {
    const points: OdometerPoint[] = [
      { odometer: 1000, at: 1, driverId: 'a' },
      { odometer: 1500, at: 10, driverId: 'b' },
    ];
    const trips: TripSpan[] = [{ start: 1000, end: 1300, at: 5, driverId: 't' }];
    const early = sum(attributeDistance(points, trips, { from: 0, to: 6 }, true));
    const late = attributeDistance(points, trips, { from: 7, to: 12 }, true);
    expect(late.get('b')).toEqual({ trips: 0, estimated: 200 });
    expect(early + sum(late)).toBe(500);
  });

  test('adjacent periods add up to the whole, whatever the readings and trips', () => {
    fc.assert(
      fc.property(journey, fc.integer({ min: 0, max: 31_000 }), ({ points, trips }, cut) => {
        const whole = sum(attributeDistance(points, trips, EVERYTHING, true));
        const before = sum(attributeDistance(points, trips, { from: 0, to: cut }, true));
        const after = attributeDistance(points, trips, { from: cut + 1, to: EVERYTHING.to }, true);
        expect(before + sum(after)).toBe(whole);
      })
    );
  });

  test('a gap goes to the driver on the reading that closes it, once the period holds that reading', () => {
    const points: OdometerPoint[] = [
      { odometer: 100, at: 1, driverId: 'a' },
      { odometer: 150, at: 5, driverId: 'b' },
      { odometer: 190, at: 9, driverId: 'c' },
    ];
    const totals = attributeDistance(points, [], { from: 4, to: 6 }, true);
    expect(totals.get('b')).toEqual({ trips: 0, estimated: 50 });
    expect(totals.has('c')).toBe(false);
  });
});
