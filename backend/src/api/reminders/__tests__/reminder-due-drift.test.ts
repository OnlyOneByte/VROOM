import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;
let vehicleId: string;

beforeEach(async () => {
  ctx = await createTestApp();
  vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: 'CX-5', year: 2020 });
});
afterEach(() => ctx.close());

async function createReminder(over: Record<string, unknown>): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/reminders', {
    name: 'Inspection',
    type: 'notification',
    frequency: 'yearly',
    startDate: '2024-01-03T12:00:00.000Z',
    vehicleIds: [vehicleId],
    ...over,
  });
  const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.reminder.id;
}

function nextDueMs(id: string): number | null {
  const row = ctx.sqlite.query('SELECT next_due_date FROM reminders WHERE id = ?').get(id) as {
    next_due_date: number | null;
  };
  return row.next_due_date === null ? null : row.next_due_date * 1000;
}

function notificationCount(id: string): number {
  return (
    ctx.sqlite
      .query('SELECT COUNT(*) AS n FROM reminder_notifications WHERE reminder_id = ?')
      .get(id) as { n: number }
  ).n;
}

async function trigger(): Promise<void> {
  expect((await ctx.authed('POST', '/api/v1/reminders/trigger')).status).toBe(200);
}

async function put(id: string, body: Record<string, unknown>): Promise<void> {
  const res = await ctx.authed('PUT', `/api/v1/reminders/${id}`, body);
  expect(res.status, await res.text()).toBe(200);
}

function firstYearlyOnOrAfter(start: Date, floor: number): number {
  const due = new Date(start.getTime());
  while (due.getTime() < floor) due.setFullYear(due.getFullYear() + 1);
  return due.getTime();
}

describe('mark-serviced after the trigger already advanced the period', () => {
  test('keeps the next due date instead of skipping a period, and is idempotent', async () => {
    const id = await createReminder({});
    await trigger();
    const afterTrigger = nextDueMs(id);
    expect(afterTrigger).not.toBeNull();
    expect(afterTrigger as number).toBeGreaterThan(Date.now());

    expect((await ctx.authed('POST', `/api/v1/reminders/${id}/mark-serviced`)).status).toBe(200);
    expect(nextDueMs(id), 'servicing the triggered period must not skip the next one').toBe(
      afterTrigger
    );

    expect((await ctx.authed('POST', `/api/v1/reminders/${id}/mark-serviced`)).status).toBe(200);
    expect(nextDueMs(id), 'a second click is a no-op').toBe(afterTrigger);
  });
});

describe('resuming a paused reminder', () => {
  test('moves the due date to the first occurrence from now, so nothing backfills', async () => {
    const id = await createReminder({ frequency: 'weekly' });
    await put(id, { isActive: false });

    const before = Date.now();
    await put(id, { isActive: true });
    expect(nextDueMs(id) as number).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);

    await trigger();
    expect(notificationCount(id), 'no catch-up notifications for the paused weeks').toBe(0);
  });
});

describe('editing the schedule recomputes the next due date', () => {
  test('a new start date in the future becomes the next due date', async () => {
    const id = await createReminder({});
    await trigger();
    await put(id, { startDate: '2099-03-10T12:00:00.000Z' });
    expect(nextDueMs(id)).toBe(Date.parse('2099-03-10T12:00:00.000Z'));
  });

  test('a frequency change lands on the new schedule’s first occurrence from now', async () => {
    const start = new Date('2024-01-03T12:00:00.000Z');
    const id = await createReminder({ frequency: 'weekly' });
    await trigger();
    const before = Date.now();
    await put(id, { frequency: 'yearly' });
    expect(nextDueMs(id)).toBe(firstYearlyOnOrAfter(start, before));
  });

  test('switching a mileage reminder to time mode does not backfill from the start date', async () => {
    const id = await createReminder({
      triggerMode: 'mileage',
      intervalMileage: 5000,
      lastServiceOdometer: 1000,
    });
    expect(nextDueMs(id)).toBeNull();

    await put(id, { triggerMode: 'time' });
    expect(nextDueMs(id) as number).toBeGreaterThan(Date.now() - 1000);

    await trigger();
    expect(notificationCount(id)).toBe(0);
  });

  test('an edit that leaves the schedule alone keeps the next due date', async () => {
    const id = await createReminder({});
    await trigger();
    const due = nextDueMs(id);
    await put(id, { name: 'Renamed', frequency: 'yearly', startDate: '2024-01-03T12:00:00.000Z' });
    expect(nextDueMs(id)).toBe(due);
  });
});
