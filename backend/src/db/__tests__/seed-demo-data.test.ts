import { beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type PaginatedEnvelope,
  type RequestFn,
  requestAs,
} from '../../test-helpers/http-client';
import { getDb } from '../connection';
import { expenses, insuranceClaims, insurancePolicies, trips, users, vehicles } from '../schema';
import { seedDatabase } from '../seed';

const db = getDb();

let demoUserId: string;
let asDemo: RequestFn;

beforeAll(async () => {
  const ctx = await createTestApp();
  await seedDatabase();
  const [demo] = await db.select().from(users).where(eq(users.email, 'demo@example.com'));
  demoUserId = demo.id;
  asDemo = (await requestAs(ctx, demoUserId)).request;
});

describe('db:init --seed', () => {
  test('gives the demo user the four trips the C3 mocks show', async () => {
    const res = await asDemo('GET', '/api/v1/trips?limit=50');
    expect(res.status).toBe(200);
    const body =
      await json<
        PaginatedEnvelope<{ startLocation: string; endLocation: string; purpose: string }>
      >(res);
    expect(
      body.data.map((t) => `${t.startLocation} → ${t.endLocation} (${t.purpose})`).sort()
    ).toEqual([
      'Home → Lake Tahoe (personal)',
      'Home → Monterey (personal)',
      'Office → Client site (business)',
      'San Jose → Tejon Ranch (business)',
    ]);
  });

  test('every trip fits between the odometer readings around it', async () => {
    const seeded = await db.select().from(trips).where(eq(trips.userId, demoUserId));
    const cars = await db.select().from(vehicles).where(eq(vehicles.userId, demoUserId));
    const readings = await db.select().from(expenses).where(eq(expenses.userId, demoUserId));
    const miles = new Map([
      ['Tejon Ranch', 248],
      ['Lake Tahoe', 412],
      ['Client site', 36],
      ['Monterey', 142],
    ]);

    for (const trip of seeded) {
      expect(trip.endOdometer - trip.startOdometer).toBe(miles.get(trip.endLocation ?? '') ?? -1);
      const car = cars.find((v) => v.id === trip.vehicleId);
      expect(trip.startOdometer).toBeGreaterThan(car?.initialMileage ?? Number.POSITIVE_INFINITY);
      const own = readings.filter((r) => r.vehicleId === trip.vehicleId && r.mileage !== null);
      const before = own.filter((r) => r.date < trip.tripDate).map((r) => r.mileage ?? 0);
      const after = own.filter((r) => r.date > trip.tripDate).map((r) => r.mileage ?? 0);
      expect(Math.max(...before)).toBeLessThanOrEqual(trip.startOdometer);
      expect(Math.min(...after)).toBeGreaterThanOrEqual(trip.endOdometer);
    }
  });

  test('adds one settled windshield claim on the State Farm policy', async () => {
    const [stateFarm] = await db
      .select()
      .from(insurancePolicies)
      .where(eq(insurancePolicies.company, 'State Farm'));
    const res = await asDemo('GET', `/api/v1/insurance/${stateFarm.id}/claims`);
    expect(res.status).toBe(200);
    const body =
      await json<DataEnvelope<{ description: string; status: string; payoutAmount: number }[]>>(
        res
      );
    expect(body.data).toEqual([
      expect.objectContaining({
        description: 'Windshield chip repair',
        status: 'settled',
        payoutAmount: 120,
      }),
    ]);
    expect(await db.select().from(insuranceClaims)).toHaveLength(1);
  });
});
