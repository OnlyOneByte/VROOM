import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';
import { addOdometerReading, seedMileageReminder } from './_helpers';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

const count = async (sql: string, ...params: string[]): Promise<number> =>
  ((await ctx.sql.get(sql, params)) as { n: number }).n;

async function trigger(): Promise<void> {
  expect((await ctx.authed('POST', '/api/v1/reminders/trigger')).status).toBe(200);
}

describe('mileage expense reminders', () => {
  test('reaching the milestone books the expense once', async () => {
    const vehicleId = await seedVehicle(ctx);
    await seedMileageReminder(ctx, 'rem-oil', vehicleId, 10000);
    await ctx.sql.run(
      "UPDATE reminders SET type = 'expense', expense_amount = 8000, expense_category = 'maintenance' WHERE id = 'rem-oil'"
    );
    await addOdometerReading(ctx, vehicleId, 10200);

    await trigger();
    await trigger();

    expect(
      await count(
        "SELECT COUNT(*) AS n FROM expenses WHERE source_type = 'reminder' AND source_id = 'rem-oil'"
      )
    ).toBe(1);
  });

  test('a time-or-mileage expense reminder books only on its due date', async () => {
    const vehicleId = await seedVehicle(ctx);
    await seedMileageReminder(ctx, 'rem-both', vehicleId, 10000);
    await ctx.sql.run(
      "UPDATE reminders SET type = 'expense', trigger_mode = 'both', frequency = 'yearly', expense_amount = 8000, expense_category = 'maintenance', next_due_date = ? WHERE id = 'rem-both'",
      [Math.floor(Date.parse('2099-01-01') / 1000)]
    );
    await addOdometerReading(ctx, vehicleId, 10200);

    await trigger();

    expect(await count("SELECT COUNT(*) AS n FROM expenses WHERE source_id = 'rem-both'")).toBe(0);
  });

  test('a notification reminder on mileage still books nothing', async () => {
    const vehicleId = await seedVehicle(ctx);
    await seedMileageReminder(ctx, 'rem-note', vehicleId, 10000);
    await addOdometerReading(ctx, vehicleId, 10200);

    await trigger();

    expect(await count("SELECT COUNT(*) AS n FROM expenses WHERE source_id = 'rem-note'")).toBe(0);
    expect(
      await count("SELECT COUNT(*) AS n FROM reminder_notifications WHERE reminder_id = 'rem-note'")
    ).toBe(1);
  });
});

describe('resuming a reminder', () => {
  test('one past its end date is refused with a reason', async () => {
    const vehicleId = await seedVehicle(ctx);
    const res = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Parking permit',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-01-01T00:00:00.000Z',
      endDate: '2024-03-01T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const created = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
    expect(res.status, JSON.stringify(created)).toBe(201);
    const id = created.data.reminder.id;
    await ctx.sql.run('UPDATE reminders SET is_active = FALSE WHERE id = ?', [id]);

    const resumed = await ctx.authed('PUT', `/api/v1/reminders/${id}`, { isActive: true });
    const body = await json<{ error?: { message?: string }; message?: string }>(resumed);

    expect(resumed.status).toBe(400);
    expect(JSON.stringify(body)).toContain('end date');
  });
});
