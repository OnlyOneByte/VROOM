/**
 * Trip errors must use the object-shaped error envelope. The frontend client reads error.message, then
 * message, then falls back to the bare status, so a string-valued error would lose the reason.
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

/** What the frontend's api-client would surface to the user for a failed response. */
async function clientMessage(res: Response): Promise<string> {
  const body = (await res.json()) as { error?: { message?: string }; message?: string };
  return body.error?.message ?? body.message ?? `Request failed with status ${res.status}`;
}

async function createTrip(): Promise<string> {
  const vehicleId = await seedVehicle(ctx, { make: 'Trip', model: 'Car', year: 2021 });
  const res = await ctx.authed('POST', '/api/v1/trips', {
    vehicleId,
    startOdometer: 1000,
    endOdometer: 1100,
    tripDate: '2024-06-01T00:00:00.000Z',
    purpose: 'business',
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.id;
}

describe('trip error envelopes', () => {
  test('deleting an already-deleted trip reports the reason, not a bare status', async () => {
    const id = await createTrip();
    expect((await ctx.authed('DELETE', `/api/v1/trips/${id}`)).status).toBe(200);

    const second = await ctx.authed('DELETE', `/api/v1/trips/${id}`);
    expect(second.status).toBe(404);
    expect(await clientMessage(second)).toBe('Trip not found');
  });

  test('a missing trip id delete matches the sibling GET envelope exactly', async () => {
    const del = await ctx.authed('DELETE', '/api/v1/trips/does-not-exist');
    const get = await ctx.authed('GET', '/api/v1/trips/does-not-exist');
    expect(del.status).toBe(404);
    expect(get.status).toBe(404);
    expect(await del.json()).toEqual(await get.json());
  });

  test('an inverted odometer pair on update reports which field was wrong', async () => {
    const id = await createTrip();
    const res = await ctx.authed('PUT', `/api/v1/trips/${id}`, { endOdometer: 900 });
    expect(res.status).toBe(400);
    expect(await clientMessage(res)).toContain('endOdometer');
  });
});
