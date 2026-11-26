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

beforeEach(async () => {
  ctx = await createTestApp();
  vehicleId = await seedVehicle(ctx, { make: 'Mazda', model: 'CX-5', year: 2020 });
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function create(over: Record<string, unknown>): Promise<Response> {
  return ctx.authed('POST', '/api/v1/reminders', {
    name: 'Inspection',
    type: 'notification',
    frequency: 'yearly',
    vehicleIds: [vehicleId],
    ...over,
  });
}

async function createId(over: Record<string, unknown>): Promise<string> {
  const res = await create(over);
  const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.reminder.id;
}

function stored(id: string): { start: number; end: number | null; due: number | null } {
  const row = ctx.sqlite
    .query('SELECT start_date, end_date, next_due_date FROM reminders WHERE id = ?')
    .get(id) as { start_date: number; end_date: number | null; next_due_date: number | null };
  const ms = (v: number | null) => (v === null ? null : v * 1000);
  return { start: row.start_date * 1000, end: ms(row.end_date), due: ms(row.next_due_date) };
}

async function put(id: string, body: Record<string, unknown>): Promise<void> {
  const res = await ctx.authed('PUT', `/api/v1/reminders/${id}`, body);
  expect(res.status, await res.text()).toBe(200);
}

describe('reminder dates as plain calendar dates', () => {
  test('a plain date with a time zone is stored as noon on that day in that zone', async () => {
    const auckland = await createId({
      startDate: '2099-06-15',
      endDate: '2100-01-15',
      timeZone: 'Pacific/Auckland',
    });
    expect(stored(auckland)).toMatchObject({
      start: Date.parse('2099-06-15T00:00:00.000Z'),
      end: Date.parse('2100-01-14T23:00:00.000Z'),
      due: Date.parse('2099-06-15T00:00:00.000Z'),
    });

    const newYork = await createId({ startDate: '2099-03-08', timeZone: 'America/New_York' });
    expect(stored(newYork).start).toBe(Date.parse('2099-03-08T16:00:00.000Z'));
  });

  test('an unknown or malformed time zone is a 400 and nothing is saved or changed', async () => {
    for (const timeZone of [
      'Mars/Olympus',
      'x'.repeat(65),
      { toString: 1 },
      [{ toString: 1 }],
      42,
      null,
    ]) {
      const res = await create({ startDate: '2099-06-15', timeZone });
      const text = await res.text();
      expect(res.status, `timeZone ${JSON.stringify(timeZone)}: ${text}`).toBe(400);
    }
    expect(ctx.sqlite.query('SELECT COUNT(*) AS n FROM reminders').get()).toEqual({ n: 0 });

    const id = await createId({ startDate: '2099-06-15' });
    const before = stored(id);
    const res = await ctx.authed('PUT', `/api/v1/reminders/${id}`, {
      startDate: '2099-06-16',
      timeZone: 'Not/AZone',
    });
    expect(res.status, await res.text()).toBe(400);
    expect(stored(id)).toEqual(before);
  });

  test('with the submitter time zone, a DST-day start stored near midnight compares by its local day', async () => {
    const id = await createId({ startDate: '2099-03-08T04:30:00.000Z' });
    const before = stored(id);

    await put(id, { name: 'Renamed', startDate: '2099-03-07', timeZone: 'America/New_York' });
    expect(stored(id), 'same local day: kept').toEqual(before);

    await put(id, { startDate: '2099-03-08', timeZone: 'America/New_York' });
    expect(stored(id).start, 'next local day: applied').toBe(
      Date.parse('2099-03-08T16:00:00.000Z')
    );
  });

  test('a plain date without a time zone is stored as UTC noon of that day', async () => {
    const id = await createId({ startDate: '2099-06-15', endDate: '2100-01-31' });
    expect(stored(id)).toMatchObject({
      start: Date.parse('2099-06-15T12:00:00.000Z'),
      end: Date.parse('2100-01-31T12:00:00.000Z'),
    });
  });

  test('a full timestamp is still accepted', async () => {
    const id = await createId({ startDate: '2099-06-15T03:00:00.000Z' });
    expect(stored(id).start).toBe(Date.parse('2099-06-15T03:00:00.000Z'));
  });

  test('a plain date that is not a real day is rejected with a clear message', async () => {
    for (const timeZone of [undefined, 'America/New_York']) {
      const res = await create({ startDate: '2099-02-30', ...(timeZone ? { timeZone } : {}) });
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { details: { issues: { path: string[]; message: string }[] } };
      };
      expect(body.error.details.issues).toContainEqual(
        expect.objectContaining({ path: ['startDate'], message: 'Enter a valid date' })
      );
    }
  });

  test('resending the stored days as plain dates keeps both stored timestamps and the due date', async () => {
    const id = await createId({
      startDate: '2099-03-09T04:00:00.000Z',
      endDate: '2100-11-02T23:30:00.000Z',
    });
    expect((await ctx.authed('POST', `/api/v1/reminders/${id}/mark-serviced`)).status).toBe(200);
    const before = stored(id);

    await put(id, {
      name: 'Renamed',
      frequency: 'yearly',
      startDate: '2099-03-09',
      endDate: '2100-11-02',
    });

    expect(stored(id)).toEqual(before);
  });

  test('a one-day change near midnight is applied, not mistaken for the same day', async () => {
    const id = await createId({ startDate: '2099-03-09T04:00:00.000Z' });

    await put(id, { startDate: '2099-03-10' });

    expect(stored(id).start).toBe(Date.parse('2099-03-10T12:00:00.000Z'));
    expect(stored(id).due).toBe(Date.parse('2099-03-10T12:00:00.000Z'));
  });

  test('clearing the end date still clears it', async () => {
    const id = await createId({ startDate: '2099-06-15', endDate: '2100-01-31' });
    await put(id, { endDate: null });
    expect(stored(id).end).toBeNull();
  });
});
