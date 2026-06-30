/**
 * trips-location T8 — PUT/GET /settings `businessMileageRate` + the trip-summary rate fallback, through the
 * REAL HTTP stack.
 *
 * Migration 0008 added `user_preferences.business_mileage_rate` (real NOT NULL DEFAULT 0). T8 wires it into
 * the settings route with an EXPLICIT bounded field (`z.number().min(0).max(100)`) and has the trip
 * mileage-summary consume it as the DEFAULT rate when no explicit ?rate= override is passed (D3: a default
 * rate in preferences + a per-request override). These pin the contract end-to-end:
 *   - GET returns the column default (0) for a fresh user;
 *   - a PUT persists a rate and GET round-trips it;
 *   - the merge is per-field (#82): setting the rate leaves sibling prefs untouched + vice-versa;
 *   - the bound rejects a negative rate and an absurd (>100 $/mile) one;
 *   - the trip summary uses the STORED rate when ?rate= is absent, and an explicit ?rate= OVERRIDES it.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface SettingsBody {
  success: boolean;
  data: { businessMileageRate: number; currencyUnit: string };
}

async function getSettings(): Promise<SettingsBody['data']> {
  const res = await ctx.authed('GET', '/api/v1/settings');
  return (await json<SettingsBody>(res)).data;
}

describe('PUT/GET /settings businessMileageRate (trips-location T8)', () => {
  test('a fresh user businessMileageRate defaults to 0 (the migration-0008 column default)', async () => {
    expect((await getSettings()).businessMileageRate).toBe(0);
  });

  test('a PUT persists businessMileageRate and GET round-trips it', async () => {
    const res = await ctx.authed('PUT', '/api/v1/settings', { businessMileageRate: 0.67 });
    const body = await json<SettingsBody>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.businessMileageRate).toBe(0.67);
    expect((await getSettings()).businessMileageRate).toBe(0.67);
  });

  test('setting businessMileageRate leaves sibling prefs untouched (per-field merge, #82)', async () => {
    await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: 'EUR' });
    await ctx.authed('PUT', '/api/v1/settings', { businessMileageRate: 0.5 });
    const data = await getSettings();
    expect(data.businessMileageRate).toBe(0.5);
    expect(data.currencyUnit).toBe('EUR'); // not wiped by the rate-only PUT

    // ...and the reverse: a sibling PUT leaves the rate untouched.
    await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: 'GBP' });
    const after = await getSettings();
    expect(after.businessMileageRate).toBe(0.5);
    expect(after.currencyUnit).toBe('GBP');
  });

  test('rejects a negative rate and an absurd (>100) rate (the abuse bound)', async () => {
    const neg = await ctx.authed('PUT', '/api/v1/settings', { businessMileageRate: -1 });
    expect(neg.status).toBe(400);
    const huge = await ctx.authed('PUT', '/api/v1/settings', { businessMileageRate: 500 });
    expect(huge.status).toBe(400);
    // The stored value is unchanged (still the default 0).
    expect((await getSettings()).businessMileageRate).toBe(0);
  });
});

describe('GET /trips/summary uses the stored businessMileageRate as the default (D3, T8)', () => {
  /** Seed a vehicle + a single 100-mile business trip; returns the vehicleId. */
  async function seedBusinessTrip(): Promise<string> {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await ctx.authed('POST', '/api/v1/trips', {
      vehicleId,
      startOdometer: 1000,
      endOdometer: 1100, // 100 business miles
      purpose: 'business',
      tripDate: '2024-06-20T13:30:00.000Z',
    });
    return vehicleId;
  }

  interface SummaryBody {
    businessMiles: number;
    businessMileageValue: number;
  }

  test('summary with NO ?rate= uses the stored businessMileageRate (100 mi × 0.5 = 50)', async () => {
    await seedBusinessTrip();
    await ctx.authed('PUT', '/api/v1/settings', { businessMileageRate: 0.5 });

    const res = await ctx.authed('GET', '/api/v1/trips/summary');
    const body = await json<DataEnvelope<SummaryBody>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.businessMiles).toBe(100);
    expect(body.data.businessMileageValue).toBe(50); // 100 × the STORED 0.5, no override passed
  });

  test('an explicit ?rate= OVERRIDES the stored default (100 mi × 1.0 = 100)', async () => {
    await seedBusinessTrip();
    await ctx.authed('PUT', '/api/v1/settings', { businessMileageRate: 0.5 });

    const res = await ctx.authed('GET', '/api/v1/trips/summary?rate=1');
    const body = await json<DataEnvelope<SummaryBody>>(res);
    expect(body.data.businessMileageValue).toBe(100); // the ?rate=1 override wins over the stored 0.5
  });

  test('with no stored rate and no override, businessMileageValue is 0 (pre-T8 behavior preserved)', async () => {
    await seedBusinessTrip();
    const res = await ctx.authed('GET', '/api/v1/trips/summary');
    const body = await json<DataEnvelope<SummaryBody>>(res);
    expect(body.data.businessMileageValue).toBe(0);
  });
});
