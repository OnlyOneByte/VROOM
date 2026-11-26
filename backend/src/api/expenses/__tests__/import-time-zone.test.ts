import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';
import { calendarDayIn, zonedParts } from '../../../utils/time-zone';
import { normalizeForeignDate } from '../import-mapping';
import { buildZonedDate } from '../local-date';

const FAR_EAST = 'Pacific/Kiritimati';
const AUCKLAND = 'Pacific/Auckland';
const LOS_ANGELES = 'America/Los_Angeles';

describe('buildZonedDate', () => {
  test.each([FAR_EAST, AUCKLAND, LOS_ANGELES, 'UTC'])(
    'a date-only value is noon on that calendar day in %s',
    (zone) => {
      const d = buildZonedDate(2024, 3, 15, zone);
      expect(d).not.toBeNull();
      expect(calendarDayIn(d as Date, zone)).toBe('2024-03-15');
      expect(zonedParts(d as Date, zone)['hour']).toBe(12);
    }
  );

  test('keeps the wall-clock time it is given in the zone', () => {
    const d = buildZonedDate(2024, 3, 15, FAR_EAST, 23, 30, 5);
    const p = zonedParts(d as Date, FAR_EAST);
    expect(calendarDayIn(d as Date, FAR_EAST)).toBe('2024-03-15');
    expect([p['hour'], p['minute'], p['second']]).toEqual([23, 30, 5]);
  });

  test('lands on the right day across an Auckland daylight-saving change', () => {
    const before = buildZonedDate(2024, 4, 6, AUCKLAND);
    const after = buildZonedDate(2024, 4, 8, AUCKLAND);
    expect(calendarDayIn(before as Date, AUCKLAND)).toBe('2024-04-06');
    expect(calendarDayIn(after as Date, AUCKLAND)).toBe('2024-04-08');
  });

  test('a wall time skipped by a midnight daylight-saving change still lands on that day', () => {
    const d = buildZonedDate(2024, 10, 6, 'America/Asuncion', 0, 30, 0);
    expect(d).not.toBeNull();
    expect(calendarDayIn(d as Date, 'America/Asuncion')).toBe('2024-10-06');
  });

  test('rejects a day that does not exist', () => {
    expect(buildZonedDate(2023, 2, 29, FAR_EAST)).toBeNull();
    expect(buildZonedDate(2024, 13, 1, FAR_EAST)).toBeNull();
  });
});

describe('normalizeForeignDate with a time zone', () => {
  test('a day-first row at a skipped midnight hour is not re-read as another month', () => {
    const iso = normalizeForeignDate('06/10/2024 00:30', 'dmy', 'America/Asuncion');
    expect(calendarDayIn(new Date(iso), 'America/Asuncion')).toBe('2024-10-06');
  });

  test('a date-only foreign row is noon on that day in the user zone', () => {
    const iso = normalizeForeignDate('15/03/2024', 'dmy', FAR_EAST);
    expect(calendarDayIn(new Date(iso), FAR_EAST)).toBe('2024-03-15');
  });

  test('a foreign row with a time keeps that wall-clock time in the user zone', () => {
    const iso = normalizeForeignDate('03/15/2024 23:45', 'mdy', FAR_EAST);
    const p = zonedParts(new Date(iso), FAR_EAST);
    expect(calendarDayIn(new Date(iso), FAR_EAST)).toBe('2024-03-15');
    expect([p['hour'], p['minute']]).toEqual([23, 45]);
  });
});

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function importedDates(): Promise<string[]> {
  const res = await ctx.authed('GET', '/api/v1/expenses?limit=100');
  const body = await json<{ data: Array<{ date: string }> }>(res);
  return body.data.map((e) => e.date);
}

describe('POST /api/v1/expenses/import with the user time zone', () => {
  test('a native date-only row is stored on that calendar day for a UTC+14 user', async () => {
    await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021, nickname: 'Daily' });
    const csv = ['date,vehicle,category,amount', '2024-03-15,Daily,misc,12.50'].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv, timeZone: FAR_EAST });

    expect(res.status, await res.text()).toBe(200);
    const [date] = await importedDates();
    expect(calendarDayIn(new Date(date as string), FAR_EAST)).toBe('2024-03-15');
  });

  test('a mapped foreign row is stored on that calendar day for a UTC+14 user', async () => {
    await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021, nickname: 'Daily' });
    const csv = ['Date,Cost,Car', '15/03/2024,12.50,Daily'].join('\n');
    const mapping = {
      columns: { date: 'Date', amount: 'Cost', vehicle: 'Car' },
      dateFormat: 'dmy',
      defaultCategory: 'misc',
    };

    const res = await ctx.authed('POST', '/api/v1/expenses/import', {
      csv,
      mapping,
      timeZone: FAR_EAST,
    });

    expect(res.status, await res.text()).toBe(200);
    const [date] = await importedDates();
    expect(calendarDayIn(new Date(date as string), FAR_EAST)).toBe('2024-03-15');
  });

  test('without a time zone a date-only row keeps the previous UTC-noon behaviour', async () => {
    await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021, nickname: 'Daily' });
    const csv = ['date,vehicle,category,amount', '2024-03-15,Daily,misc,12.50'].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv });

    expect(res.status, await res.text()).toBe(200);
    expect(await importedDates()).toEqual(['2024-03-15T12:00:00.000Z']);
  });

  test('an unknown time zone is rejected', async () => {
    await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021, nickname: 'Daily' });
    const csv = ['date,vehicle,category,amount', '2024-03-15,Daily,misc,12.50'].join('\n');

    const res = await ctx.authed('POST', '/api/v1/expenses/import', {
      csv,
      timeZone: 'Mars/Olympus_Mons',
    });

    const text = await res.text();
    expect(res.status, text).toBe(400);
    expect(text).toContain('Unknown time zone');
  });
});

describe('GET /api/v1/expenses/summary with the user time zone', () => {
  async function seedFirstOfMonthExpense(): Promise<void> {
    await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021, nickname: 'Daily' });
    const csv = ['date,vehicle,category,amount', '2024-03-01,Daily,misc,40.00'].join('\n');
    const res = await ctx.authed('POST', '/api/v1/expenses/import', { csv, timeZone: FAR_EAST });
    expect(res.status, await res.text()).toBe(200);
  }

  async function trend(query: string): Promise<Array<{ period: string; amount: number }>> {
    const res = await ctx.authed('GET', `/api/v1/expenses/summary${query}`);
    const body = await json<{ data: { monthlyTrend: Array<{ period: string; amount: number }> } }>(
      res
    );
    expect(res.status, JSON.stringify(body)).toBe(200);
    return body.data.monthlyTrend;
  }

  test('an expense on the 1st is in that month for a UTC+14 user', async () => {
    await seedFirstOfMonthExpense();
    const months = await trend(`?timeZone=${encodeURIComponent(FAR_EAST)}`);
    expect(months.map((m) => m.period)).toEqual(['2024-03']);
    expect(months[0]?.amount).toBe(40);
  });

  test('without a time zone the trend keeps grouping by UTC month', async () => {
    await seedFirstOfMonthExpense();
    expect((await trend('')).map((m) => m.period)).toEqual(['2024-02']);
  });

  test('an unknown time zone is rejected', async () => {
    const res = await ctx.authed('GET', '/api/v1/expenses/summary?timeZone=Mars%2FOlympus_Mons');
    expect(res.status, await res.text()).toBe(400);
  });
});
