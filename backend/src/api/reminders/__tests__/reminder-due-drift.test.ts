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
let vehicleId: string;
let isSameSubmittedDay: typeof import('../routes').isSameSubmittedDay;

beforeEach(async () => {
  ctx = await createTestApp();
  ({ isSameSubmittedDay } = await import('../routes'));
  vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: 'CX-5', year: 2020 });
}, SETUP_TIMEOUT_MS);
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

async function nextDueMs(id: string): Promise<number | null> {
  const row = (await ctx.sql.get('SELECT next_due_date FROM reminders WHERE id = ?', [id])) as {
    next_due_date: number | null;
  };
  return row.next_due_date === null ? null : row.next_due_date * 1000;
}

async function notificationCount(id: string): Promise<number> {
  return (
    (await ctx.sql.get('SELECT COUNT(*) AS n FROM reminder_notifications WHERE reminder_id = ?', [
      id,
    ])) as { n: number }
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
    const afterTrigger = await nextDueMs(id);
    expect(afterTrigger).not.toBeNull();
    expect(afterTrigger as number).toBeGreaterThan(Date.now());

    expect((await ctx.authed('POST', `/api/v1/reminders/${id}/mark-serviced`)).status).toBe(200);
    expect(await nextDueMs(id), 'servicing the triggered period must not skip the next one').toBe(
      afterTrigger
    );

    expect((await ctx.authed('POST', `/api/v1/reminders/${id}/mark-serviced`)).status).toBe(200);
    expect(await nextDueMs(id), 'a second click is a no-op').toBe(afterTrigger);
  });
});

describe('resuming a paused reminder', () => {
  test('moves the due date to the first occurrence from now, so nothing backfills', async () => {
    const id = await createReminder({ frequency: 'weekly' });
    await put(id, { isActive: false });

    const before = Date.now();
    await put(id, { isActive: true });
    expect((await nextDueMs(id)) as number).toBeGreaterThanOrEqual(
      Math.floor(before / 1000) * 1000
    );

    await trigger();
    expect(await notificationCount(id), 'no catch-up notifications for the paused weeks').toBe(0);
  });
});

describe('editing the schedule recomputes the next due date', () => {
  test('a new start date in the future becomes the next due date', async () => {
    const id = await createReminder({});
    await trigger();
    await put(id, { startDate: '2099-03-10T12:00:00.000Z' });
    expect(await nextDueMs(id)).toBe(Date.parse('2099-03-10T12:00:00.000Z'));
  });

  test('a frequency change lands on the new schedule’s first occurrence from now', async () => {
    const start = new Date('2024-01-03T12:00:00.000Z');
    const id = await createReminder({ frequency: 'weekly' });
    await trigger();
    const before = Date.now();
    await put(id, { frequency: 'yearly' });
    expect(await nextDueMs(id)).toBe(firstYearlyOnOrAfter(start, before));
  });

  test('switching a mileage reminder to time mode does not backfill from the start date', async () => {
    const id = await createReminder({
      triggerMode: 'mileage',
      intervalMileage: 5000,
      lastServiceOdometer: 1000,
    });
    expect(await nextDueMs(id)).toBeNull();

    await put(id, { triggerMode: 'time' });
    expect((await nextDueMs(id)) as number).toBeGreaterThan(Date.now() - 1000);

    await trigger();
    expect(await notificationCount(id)).toBe(0);
  });

  test('a frontend save with unchanged schedule fields keeps an early-serviced due date', async () => {
    const start = '2099-06-15T03:00:00.000Z';
    const id = await createReminder({ startDate: start, intervalValue: 1, intervalUnit: 'year' });
    expect((await ctx.authed('POST', `/api/v1/reminders/${id}/mark-serviced`)).status).toBe(200);
    const serviced = await nextDueMs(id);
    expect(serviced, 'early service moved past the first occurrence').toBeGreaterThan(
      Date.parse(start)
    );

    const s = new Date(start);
    const formStartDate = new Date(s.getFullYear(), s.getMonth(), s.getDate(), 12).toISOString();
    await put(id, {
      name: 'Renamed',
      frequency: 'yearly',
      intervalValue: null,
      intervalUnit: null,
      triggerMode: 'time',
      startDate: formStartDate,
    });

    expect(await nextDueMs(id), 'a recompute would move it back to the first occurrence').toBe(
      serviced
    );
    const row = (await ctx.sql.get('SELECT start_date FROM reminders WHERE id = ?', [id])) as {
      start_date: number;
    };
    expect(row.start_date * 1000, 'the stored start date is kept').toBe(Date.parse(start));
  });
});

describe('isSameSubmittedDay', () => {
  const stored = new Date('2099-06-15T20:00:00.000Z');

  test('treats a form save of the same calendar day as unchanged in any timezone', () => {
    expect(isSameSubmittedDay(stored, stored)).toBe(true);
    expect(isSameSubmittedDay(stored, new Date('2099-06-16T03:00:00.000Z'))).toBe(true);
    expect(isSameSubmittedDay(stored, new Date('2099-06-15T17:00:00.000Z'))).toBe(true);
    expect(isSameSubmittedDay(stored, new Date('2099-06-15T23:00:00.000Z'))).toBe(true);
  });

  test('sees a different calendar day as a change', () => {
    expect(isSameSubmittedDay(stored, new Date('2099-06-17T03:00:00.000Z'))).toBe(false);
    expect(isSameSubmittedDay(stored, new Date('2099-06-14T17:00:00.000Z'))).toBe(false);
  });
});

describe('a resumed or rescheduled reminder whose end date has passed', () => {
  async function isActive(id: string): Promise<boolean> {
    return (
      (
        (await ctx.sql.get('SELECT is_active FROM reminders WHERE id = ?', [id])) as {
          is_active: number;
        }
      ).is_active === 1
    );
  }

  test('refuses a resume and stays off', async () => {
    const id = await createReminder({ frequency: 'weekly', endDate: '2025-01-01T12:00:00.000Z' });
    await put(id, { isActive: false });
    const res = await ctx.authed('PUT', `/api/v1/reminders/${id}`, { isActive: true });
    expect(res.status).toBe(400);
    expect(await isActive(id)).toBe(false);
  });

  test('is switched off on a schedule change', async () => {
    const id = await createReminder({ frequency: 'weekly', endDate: '2025-01-01T12:00:00.000Z' });
    await put(id, { frequency: 'monthly' });
    expect(await isActive(id)).toBe(false);
  });

  test('stays on when the end date is still ahead', async () => {
    const id = await createReminder({ frequency: 'weekly', endDate: '2099-01-01T12:00:00.000Z' });
    await put(id, { isActive: false });
    await put(id, { isActive: true });
    expect(await isActive(id)).toBe(true);
  });
});
