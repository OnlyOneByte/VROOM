import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, json, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

describe('POST /api/v1/shares with an email no account uses', () => {
  test('answers 404 with one plain sentence', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });

    const res = await ctx.authed('POST', '/api/v1/shares', {
      vehicleId,
      email: 'nobody-here@example.com',
      level: 'viewer',
    });
    const body = await json<{ success: boolean; error: { message: string } }>(res);

    expect(res.status).toBe(404);
    expect(body.error.message).toBe('No VROOM account uses that email.');
  });
});
