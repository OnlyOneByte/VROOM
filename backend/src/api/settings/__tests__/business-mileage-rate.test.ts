import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
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

  test('rejects a negative rate and keeps the stored one', async () => {
    const neg = await ctx.authed('PUT', '/api/v1/settings', { businessMileageRate: -1 });
    expect(neg.status).toBe(400);
    expect((await getSettings()).businessMileageRate).toBe(0);
  });

  test('refuses a rate over 1,000,000 so the summary maths stays finite', async () => {
    const res = await ctx.authed('PUT', '/api/v1/settings', { businessMileageRate: 1_000_001 });
    expect(res.status).toBe(400);
    expect((await getSettings()).businessMileageRate).toBe(0);
  });

  test('accepts a rate in a currency without cents (300 won per km)', async () => {
    await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: 'KRW' });
    const res = await ctx.authed('PUT', '/api/v1/settings', { businessMileageRate: 300 });
    expect(res.status).toBe(200);
    expect((await getSettings()).businessMileageRate).toBe(300);
  });
});

describe('changing the distance unit converts the stored rate', () => {
  interface WithUnits {
    businessMileageRate: number;
    unitPreferences: { distanceUnit: string };
  }

  async function read(): Promise<WithUnits> {
    const res = await ctx.authed('GET', '/api/v1/settings');
    return (await json<{ data: WithUnits }>(res)).data;
  }

  test('0.67 per mile becomes 0.4163 per km, and back to 0.67 per mile', async () => {
    await ctx.authed('PUT', '/api/v1/settings', {
      unitPreferences: { distanceUnit: 'miles' },
      businessMileageRate: 0.67,
    });

    await ctx.authed('PUT', '/api/v1/settings', {
      unitPreferences: { distanceUnit: 'kilometers' },
    });
    const perKm = await read();
    expect(perKm.unitPreferences.distanceUnit).toBe('kilometers');
    expect(perKm.businessMileageRate).toBe(0.4163);

    await ctx.authed('PUT', '/api/v1/settings', { unitPreferences: { distanceUnit: 'miles' } });
    expect((await read()).businessMileageRate).toBeCloseTo(0.67, 3);
  });

  test('a rate sent with the unit change is saved as given, not converted', async () => {
    await ctx.authed('PUT', '/api/v1/settings', {
      unitPreferences: { distanceUnit: 'miles' },
      businessMileageRate: 0.67,
    });
    await ctx.authed('PUT', '/api/v1/settings', {
      unitPreferences: { distanceUnit: 'kilometers' },
      businessMileageRate: 0.5,
    });
    expect((await read()).businessMileageRate).toBe(0.5);
  });

  test('changing currency and distance in one request converts the rate once', async () => {
    await ctx.authed('PUT', '/api/v1/settings', {
      unitPreferences: { distanceUnit: 'miles' },
      businessMileageRate: 0.67,
    });
    const res = await ctx.authed('PUT', '/api/v1/settings', {
      currencyUnit: 'EUR',
      unitPreferences: { distanceUnit: 'kilometers' },
    });
    expect(res.status).toBe(200);
    const data = await read();
    expect(data.unitPreferences.distanceUnit).toBe('kilometers');
    expect(data.businessMileageRate).toBe(0.4163);
  });

  test('a converted rate never passes the 1,000,000 ceiling, so it can be saved again', async () => {
    await ctx.authed('PUT', '/api/v1/settings', {
      unitPreferences: { distanceUnit: 'kilometers' },
      businessMileageRate: 1_000_000,
    });
    await ctx.authed('PUT', '/api/v1/settings', { unitPreferences: { distanceUnit: 'miles' } });
    const perMile = (await read()).businessMileageRate;
    expect(perMile).toBe(1_000_000);

    const again = await ctx.authed('PUT', '/api/v1/settings', { businessMileageRate: perMile });
    expect(again.status).toBe(200);
  });

  test('a tiny rate stays on after a unit change instead of rounding to 0', async () => {
    await ctx.authed('PUT', '/api/v1/settings', {
      unitPreferences: { distanceUnit: 'miles' },
      businessMileageRate: 0.00004,
    });
    await ctx.authed('PUT', '/api/v1/settings', {
      unitPreferences: { distanceUnit: 'kilometers' },
    });
    expect((await read()).businessMileageRate).toBe(0.00002485);
  });

  test('a converted rate under 0.0001 keeps 4 significant digits instead of rounding up to 0.0001', async () => {
    await ctx.authed('PUT', '/api/v1/settings', {
      unitPreferences: { distanceUnit: 'miles' },
      businessMileageRate: 0.000081,
    });
    await ctx.authed('PUT', '/api/v1/settings', {
      unitPreferences: { distanceUnit: 'kilometers' },
    });
    expect((await read()).businessMileageRate).toBe(0.00005033);
  });

  test('changing only the fuel unit leaves the rate alone', async () => {
    await ctx.authed('PUT', '/api/v1/settings', {
      unitPreferences: { distanceUnit: 'miles' },
      businessMileageRate: 0.67,
    });
    await ctx.authed('PUT', '/api/v1/settings', { unitPreferences: { volumeUnit: 'liters' } });
    expect((await read()).businessMileageRate).toBe(0.67);
  });
});

describe('GET /trips/summary uses the stored businessMileageRate as the default', () => {
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
    businessDistance: number;
    businessMileageValue: number;
  }

  test('summary without ?rate= uses the stored rate (100 mi × 0.5 = 50)', async () => {
    await seedBusinessTrip();
    await ctx.authed('PUT', '/api/v1/settings', { businessMileageRate: 0.5 });

    const res = await ctx.authed('GET', '/api/v1/trips/summary');
    const body = await json<DataEnvelope<SummaryBody>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.businessDistance).toBe(100);
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
