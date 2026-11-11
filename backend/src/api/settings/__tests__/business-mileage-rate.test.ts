/**
 * businessMileageRate through the HTTP stack: the stored default rate, per-field merge, the bound
 * on accepted values, and the trip summary using the stored rate unless ?rate= overrides it.
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

describe('PUT/GET /settings businessMileageRate', () => {
  test('a fresh user businessMileageRate defaults to 0', async () => {
    expect((await getSettings()).businessMileageRate).toBe(0);
  });

  test('a PUT persists businessMileageRate and GET round-trips it', async () => {
    const res = await ctx.authed('PUT', '/api/v1/settings', { businessMileageRate: 0.67 });
    const body = await json<SettingsBody>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.businessMileageRate).toBe(0.67);
    expect((await getSettings()).businessMileageRate).toBe(0.67);
  });

  test('setting businessMileageRate leaves sibling prefs untouched (per-field merge)', async () => {
    await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: 'EUR' });
    await ctx.authed('PUT', '/api/v1/settings', { businessMileageRate: 0.5 });
    const data = await getSettings();
    expect(data.businessMileageRate).toBe(0.5);
    expect(data.currencyUnit).toBe('EUR');

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
    expect((await getSettings()).businessMileageRate).toBe(0);
  });
});

describe('GET /trips/summary uses the stored businessMileageRate as the default', () => {
  /** Seeds a vehicle and one 100-mile business trip. */
  async function seedBusinessTrip(): Promise<string> {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    await ctx.authed('POST', '/api/v1/trips', {
      vehicleId,
      startOdometer: 1000,
      endOdometer: 1100,
      purpose: 'business',
      tripDate: '2024-06-20T13:30:00.000Z',
    });
    return vehicleId;
  }

  interface SummaryBody {
    businessMiles: number;
    businessMileageValue: number;
  }

  test('summary without ?rate= uses the stored rate (100 mi × 0.5 = 50)', async () => {
    await seedBusinessTrip();
    await ctx.authed('PUT', '/api/v1/settings', { businessMileageRate: 0.5 });

    const res = await ctx.authed('GET', '/api/v1/trips/summary');
    const body = await json<DataEnvelope<SummaryBody>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.businessMiles).toBe(100);
    expect(body.data.businessMileageValue).toBe(50);
  });

  test('an explicit ?rate= overrides the stored default (100 mi × 1.0 = 100)', async () => {
    await seedBusinessTrip();
    await ctx.authed('PUT', '/api/v1/settings', { businessMileageRate: 0.5 });

    const res = await ctx.authed('GET', '/api/v1/trips/summary?rate=1');
    const body = await json<DataEnvelope<SummaryBody>>(res);
    expect(body.data.businessMileageValue).toBe(100);
  });

  test('with no stored rate and no override, businessMileageValue is 0', async () => {
    await seedBusinessTrip();
    const res = await ctx.authed('GET', '/api/v1/trips/summary');
    const body = await json<DataEnvelope<SummaryBody>>(res);
    expect(body.data.businessMileageValue).toBe(0);
  });
});
