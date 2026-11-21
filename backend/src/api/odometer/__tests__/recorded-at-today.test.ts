import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

const EARLY_MORNING = new Date(2026, 10, 21, 4, 30, 0);
const TODAY_AT_NOON = new Date(2026, 10, 21, 12, 0, 0).toISOString();
const TOMORROW_AT_NOON = new Date(2026, 10, 22, 12, 0, 0).toISOString();

let ctx: TestApp;

beforeEach(async () => {
  setSystemTime(EARLY_MORNING);
  ctx = await createTestApp();
});
afterEach(() => {
  ctx.close();
  setSystemTime();
});

describe('odometer recordedAt before noon on the same day', () => {
  test('a reading dated today at local noon is accepted early in the morning', async () => {
    const vehicleId = await seedVehicle(ctx);

    const res = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
      odometer: 42_000,
      recordedAt: TODAY_AT_NOON,
    });

    const body = await json<DataEnvelope<{ id: string; odometer: number }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(body.data.odometer).toBe(42_000);
  });

  test('a reading dated tomorrow is still rejected as in the future', async () => {
    const vehicleId = await seedVehicle(ctx);

    const res = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
      odometer: 42_000,
      recordedAt: TOMORROW_AT_NOON,
    });

    const text = await res.text();
    expect(res.status, text).toBe(400);
    expect(text).toContain('Date cannot be in the future');
  });

  test('moving an existing reading to today at local noon is accepted early in the morning', async () => {
    const vehicleId = await seedVehicle(ctx);
    const created = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
      odometer: 41_000,
      recordedAt: new Date(2026, 10, 20, 12, 0, 0).toISOString(),
    });
    const { data } = await json<DataEnvelope<{ id: string }>>(created);

    const res = await ctx.authed('PUT', `/api/v1/odometer/${data.id}`, {
      recordedAt: TODAY_AT_NOON,
    });

    expect(res.status, await res.text()).toBe(200);
  });
});
