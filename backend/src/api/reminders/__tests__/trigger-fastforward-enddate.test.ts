/**
 * A bounded reminder that lapses past the catch-up cap must be deactivated by the fast-forward path,
 * not left active and dormant.
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

function reminderRow(id: string): { is_active: number } {
  return ctx.sqlite.query('SELECT is_active FROM reminders WHERE id = ?').get(id) as {
    is_active: number;
  };
}

describe('fast-forward past the catch-up cap honors endDate', () => {
  test('a lapsed bounded reminder past the catch-up cap is deactivated, not left active', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: '3', year: 2019 });

    // Weekly from 2024-01-01 with the 12-occurrence cap reached before endDate, so only the fast-forward
    // path sees endDate.
    const createRes = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Bounded weekly checkup',
      type: 'notification',
      frequency: 'weekly',
      startDate: '2024-01-01T00:00:00.000Z',
      endDate: '2024-06-01T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const created = await json<DataEnvelope<{ reminder: { id: string } }>>(createRes);
    expect(createRes.status, JSON.stringify(created)).toBe(201);
    const reminderId = created.data.reminder.id;

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(res.status).toBe(200);

    // The reminder is bounded and fully lapsed → it must be deactivated, not active-and-dormant.
    expect(reminderRow(reminderId).is_active).toBe(0);
  });

  // The final advance can step past both now and endDate, so the exit value must be checked too.
  test('a bounded reminder whose endDate lands in the period straddling now is deactivated, not advanced past it', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: '3', year: 2019 });

    // endDate one second before now lands in the period straddling now, so only the exit guard sees it.
    const endDate = new Date(Date.now() - 1000).toISOString();

    const createRes = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Bounded monthly checkup ending ~now',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-01-01T00:00:00.000Z',
      endDate,
      vehicleIds: [vehicleId],
    });
    const created = await json<DataEnvelope<{ reminder: { id: string } }>>(createRes);
    expect(createRes.status, JSON.stringify(created)).toBe(201);
    const reminderId = created.data.reminder.id;

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(res.status).toBe(200);

    expect(reminderRow(reminderId).is_active).toBe(0);
  });
});
