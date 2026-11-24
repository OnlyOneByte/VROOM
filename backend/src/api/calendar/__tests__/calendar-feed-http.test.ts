import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { CONFIG } from '../../../config';
import { getDb } from '../../../db/connection';
import { calendarFeeds, reminders, reminderVehicles, users, vehicles } from '../../../db/schema';
import { seedGarage } from '../../../db/seed';
import {
  createTestApp,
  type DataEnvelope,
  json,
  requestAs,
  socketFrom,
  type TestApp,
} from '../../../test-helpers/http-client';

const db = getDb();

let ctx: TestApp;
let visitor = 0;

interface FeedResponse {
  feed: { options: Record<string, boolean>; createdAt: string; lastUsedAt: string | null } | null;
  path?: string;
}

async function seedReminder(userId: string, name: string, vehicleId: string): Promise<void> {
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + 10);
  const [row] = await db
    .insert(reminders)
    .values({
      userId,
      name,
      type: 'expense',
      frequency: 'monthly',
      startDate: new Date(),
      nextDueDate: due,
      expenseAmount: 4500,
      expenseCategory: 'maintenance',
    })
    .returning();
  await db.insert(reminderVehicles).values({ reminderId: row.id, vehicleId });
}

async function ownGarage(userId: string): Promise<void> {
  await seedGarage(userId);
  const cars = await db.select().from(vehicles).where(eq(vehicles.userId, userId));
  const car = cars.find((v) => v.nickname === 'Daily Driver') ?? cars[0];
  await seedReminder(userId, 'Oil change', car.id);
}

async function fetchFeed(path: string, ip = `198.51.100.${++visitor}`): Promise<Response> {
  const url = path.startsWith('/api/') ? path : `/api/v1${path}`;
  return await ctx.app.request(url, {}, socketFrom(ip));
}

async function createFeed(options?: Record<string, boolean | string>): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/calendar/feed', options ? { options } : {});
  expect(res.status).toBe(201);
  return (await json<DataEnvelope<FeedResponse>>(res)).data.path as string;
}

beforeEach(async () => {
  ctx = await createTestApp();
});

afterEach(() => ctx.close());

describe('the calendar feed link', () => {
  test('is shown once, and only its hash is stored', async () => {
    const path = await createFeed();
    const token = path.match(/feed\/(.+)\.ics$/)?.[1] ?? '';
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const status = await json<DataEnvelope<FeedResponse>>(
      await ctx.authed('GET', '/api/v1/calendar/feed')
    );
    expect(status.data.feed?.options).toEqual({
      reminders: true,
      insurance: true,
      loans: true,
      vehicleNames: false,
      amounts: false,
    });
    expect(JSON.stringify(status)).not.toContain(token);
    const rows = ctx.sqlite.query('SELECT * FROM calendar_feeds').all();
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  test('serves the user’s reminders, insurance renewals and loan payments as ICS', async () => {
    await ownGarage(ctx.user.id);
    const res = await fetchFeed(await createFeed());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(res.headers.get('set-cookie')).toBeNull();
    const ics = await res.text();
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('SUMMARY:Reminder: Oil change\r\n');
    expect(ics).toContain('SUMMARY:Insurance renews: State Farm\r\n');
    expect(ics).toContain('SUMMARY:Loan payment\r\n');
  });

  test('carries no vehicle name or amount unless the user opts in', async () => {
    await ownGarage(ctx.user.id);
    const plain = await (await fetchFeed(await createFeed())).text();
    expect(plain).not.toMatch(/Daily Driver|Weekend Car|\$/);

    await ctx.authed('PUT', '/api/v1/calendar/feed', {
      options: { vehicleNames: true, amounts: true, insurance: false },
    });
    const rich = await (await fetchFeed(await createFeed())).text();
    expect(rich).toContain('Reminder: Oil change · Daily Driver · $45.00');
    expect(rich).toContain('Loan payment · Daily Driver · $372.86');
    expect(rich).not.toContain('Insurance renews');
  });

  test('a new link kills the old one, and turning it off kills both', async () => {
    const first = await createFeed();
    const second = await createFeed();
    expect((await fetchFeed(first)).status).toBe(404);
    expect((await fetchFeed(second)).status).toBe(200);

    expect((await ctx.authed('DELETE', '/api/v1/calendar/feed')).status).toBe(200);
    expect((await fetchFeed(second)).status).toBe(404);
    const status = await json<DataEnvelope<FeedResponse>>(
      await ctx.authed('GET', '/api/v1/calendar/feed')
    );
    expect(status.data.feed).toBeNull();
  });

  test('a made-up, malformed or other-shaped token is a plain 404', async () => {
    await createFeed();
    for (const file of [
      `${'A'.repeat(43)}.ics`,
      'short.ics',
      `${'A'.repeat(43)}.txt`,
      '..%2F.ics',
    ]) {
      const res = await fetchFeed(`/api/v1/calendar/feed/${file}`);
      expect(`${file} ${res.status}`).toBe(`${file} 404`);
    }
  });

  test('one user’s link never shows another user’s data, shared cars included', async () => {
    const otherId = 'calendar-other-user';
    await db
      .insert(users)
      .values({ id: otherId, email: 'other@example.com', displayName: 'Other' });
    await ownGarage(otherId);
    await db.update(reminders).set({ name: 'Secret service' }).where(eq(reminders.userId, otherId));
    const [theirCar] = await db.select().from(vehicles).where(eq(vehicles.userId, otherId));
    ctx.sqlite.run(
      `INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status)
       VALUES ('share-1', ?, ?, ?, 'viewer', 'accepted')`,
      [theirCar.id, otherId, ctx.user.id]
    );

    const mine = await (await fetchFeed(await createFeed({ vehicleNames: true }))).text();
    expect(mine).not.toContain('Secret service');
    expect(mine).not.toContain('Insurance renews');
    expect(mine).not.toContain('Loan payment');

    const theirs = await requestAs(ctx, otherId);
    const theirPath = (
      await json<DataEnvelope<FeedResponse>>(
        await theirs.request('POST', '/api/v1/calendar/feed', {})
      )
    ).data.path as string;
    const theirFeed = await (await fetchFeed(theirPath)).text();
    expect(theirFeed).toContain('Secret service');
    await theirs.request('DELETE', '/api/v1/calendar/feed');
    expect(
      await db.select().from(calendarFeeds).where(eq(calendarFeeds.userId, ctx.user.id))
    ).toHaveLength(1);
  });

  test('the settings routes need a session; the link alone cannot manage the feed', async () => {
    const path = await createFeed();
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      const res = await ctx.anon(
        method,
        '/api/v1/calendar/feed',
        method === 'GET' ? undefined : {}
      );
      expect(`${method} ${res.status}`).toBe(`${method} 401`);
    }
    expect((await fetchFeed(path)).status).toBe(200);
  });

  test('fetching the feed is rate-limited per client', async () => {
    const path = await createFeed();
    const statuses: number[] = [];
    for (let i = 0; i <= CONFIG.rateLimit.calendar.limit; i++) {
      statuses.push((await fetchFeed(path, '203.0.113.77')).status);
    }
    expect(statuses.slice(0, -1).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  test('the feed is served with no referrer, whatever the app-wide headers say', async () => {
    const res = await fetchFeed(await createFeed());
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const other = await ctx.authed('GET', '/api/v1/calendar/feed');
    expect(other.headers.get('referrer-policy')).not.toBe('no-referrer');
  });

  test('two first-time creates at once both succeed and leave one feed', async () => {
    const [a, b] = await Promise.all([
      ctx.authed('POST', '/api/v1/calendar/feed', {}),
      ctx.authed('POST', '/api/v1/calendar/feed', {}),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(ctx.sqlite.query('SELECT COUNT(*) AS n FROM calendar_feeds').get()).toEqual({ n: 1 });
  });

  test('events fall on the user’s own calendar day, given their time zone', async () => {
    const [car] = await db
      .insert(vehicles)
      .values({ userId: ctx.user.id, make: 'Kia', model: 'Niro', year: 2022 })
      .returning();
    const due = new Date('2027-01-10T12:00:00+13:00');
    const [row] = await db
      .insert(reminders)
      .values({
        userId: ctx.user.id,
        name: 'Warrant of fitness',
        type: 'notification',
        frequency: 'yearly',
        startDate: new Date(),
        nextDueDate: due,
      })
      .returning();
    await db.insert(reminderVehicles).values({ reminderId: row.id, vehicleId: car.id });
    const local = await (
      await fetchFeed(await createFeed({ timeZone: 'Pacific/Auckland' }))
    ).text();
    expect(local).toContain('DTSTART;VALUE=DATE:20270110');
    const bad = await ctx.authed('PUT', '/api/v1/calendar/feed', {
      options: { timeZone: 'Mars/Base' },
    });
    expect(bad.status).toBe(400);
  });

  test('an insurance term renewing today stays in the feed at UTC+14', async () => {
    await ownGarage(ctx.user.id);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Kiritimati' });
    ctx.sqlite.run(
      `UPDATE insurance_terms SET end_date = ? WHERE policy_id IN (SELECT id FROM insurance_policies WHERE user_id = ? AND company = 'State Farm')`,
      [Math.floor(new Date(`${today}T12:00:00+14:00`).getTime() / 1000), ctx.user.id]
    );
    const ics = await (
      await fetchFeed(await createFeed({ timeZone: 'Pacific/Kiritimati' }))
    ).text();
    expect(ics).toContain(`DTSTART;VALUE=DATE:${today.replace(/-/g, '')}\r\nDTEND`);
    expect(ics).toContain('Insurance renews: State Farm');
  });

  test('the request log shows the feed path with the token redacted', async () => {
    const path = await createFeed();
    const token = path.match(/feed\/(.+)\.ics$/)?.[1] ?? '';
    const log = spyOn(console, 'log');
    try {
      await fetchFeed(path);
      await fetchFeed(path.toUpperCase());
      await fetchFeed(path.replace('/feed/', '//feed//'));
      await fetchFeed(path.replace('/feed/', '/%66eed/'));
      const lines = log.mock.calls.map((call) => call.join(' '));
      expect(lines.some((line) => line.includes('/calendar/feed/[redacted]'))).toBe(true);
      expect(lines.some((line) => line.includes(token))).toBe(false);
      expect(lines.some((line) => line.toLowerCase().includes(token.toLowerCase()))).toBe(false);
    } finally {
      log.mockRestore();
    }
  });

  test('a percent-escaped link is a 404 and never reaches the log', async () => {
    const path = await createFeed();
    const token = path.match(/feed\/(.+)\.ics$/)?.[1] ?? '';
    const hex = (char: string) => `%${char.charCodeAt(0).toString(16)}`;
    const log = spyOn(console, 'log');
    try {
      for (const variant of [
        path.replace('/calendar/', '/%63alendar/'),
        path.replace('/calendar/', '/%2563alendar/'),
        `/api${path}`,
        `/api${path.replace('/calendar/', '/%63alendar/')}`,
        `/api${path.replace('.ics', '%0A.ics')}`,
        `/api${path.replace('/calendar/', '/cal%09endar/')}`,
        ...['%09', '%0A', '%20', '%2F'].flatMap((split) => {
          const broken = path.replace(token, `${token.slice(0, 21)}${split}${token.slice(21)}`);
          return [broken, `/api${broken}`];
        }),
        path.replace(token, `${token.slice(0, 21)}${hex(token[21])}${token.slice(22)}`),
        path.replace(token, `${token.slice(0, 21)}%25${hex(token[21]).slice(1)}${token.slice(22)}`),
      ]) {
        const res = await fetchFeed(variant);
        expect(`${variant.length} ${res.status}`).toBe(`${variant.length} 404`);
      }
      const lines = log.mock.calls.map((call) => call.join(' '));
      for (const piece of [token.slice(0, 20), token.slice(12, 32), token.slice(-20)]) {
        expect(lines.some((line) => line.includes(piece))).toBe(false);
      }
    } finally {
      log.mockRestore();
    }
  });
});
