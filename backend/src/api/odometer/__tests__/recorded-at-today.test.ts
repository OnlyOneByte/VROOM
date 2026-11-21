import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp | undefined;

afterEach(() => {
  setSystemTime();
  ctx?.close();
  ctx = undefined;
});

async function postReading(now: string, recordedAt: string): Promise<Response> {
  setSystemTime(new Date(now));
  ctx = await createTestApp();
  const vehicleId = await seedVehicle(ctx);
  return ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, { odometer: 42_000, recordedAt });
}

describe('odometer recordedAt sent as local noon is judged in the user’s day, not the server’s', () => {
  test('a Tokyo user just after midnight can save a reading dated today', async () => {
    const res = await postReading('2026-11-21T15:05:00.000Z', '2026-11-22T03:00:00.000Z');
    const body = await json<DataEnvelope<{ odometer: number }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(body.data.odometer).toBe(42_000);
  });

  test('an Auckland user just after midnight can save a reading dated today', async () => {
    const res = await postReading('2026-11-21T11:30:00.000Z', '2026-11-21T23:00:00.000Z');
    expect(res.status, await res.text()).toBe(201);
  });

  test('a UTC user early in the morning can save a reading dated today', async () => {
    const res = await postReading('2026-11-21T04:30:00.000Z', '2026-11-21T12:00:00.000Z');
    expect(res.status, await res.text()).toBe(201);
  });

  test('a Los Angeles user in the evening cannot save a reading dated tomorrow', async () => {
    const res = await postReading('2026-11-22T04:00:00.000Z', '2026-11-22T20:00:00.000Z');
    const text = await res.text();
    expect(res.status, text).toBe(400);
    expect(text).toContain('Date cannot be in the future');
  });

  test('a Los Angeles user a minute before midnight cannot save a reading dated tomorrow', async () => {
    const res = await postReading('2026-11-22T07:59:00.000Z', '2026-11-22T20:00:00.000Z');
    expect(res.status, await res.text()).toBe(400);
  });

  test('moving an existing reading to today at local noon is accepted early in the morning', async () => {
    const created = await postReading('2026-11-21T04:30:00.000Z', '2026-11-20T12:00:00.000Z');
    const { data } = await json<DataEnvelope<{ id: string }>>(created);

    const res = await (ctx as TestApp).authed('PUT', `/api/v1/odometer/${data.id}`, {
      recordedAt: '2026-11-21T12:00:00.000Z',
    });

    expect(res.status, await res.text()).toBe(200);
  });
});
