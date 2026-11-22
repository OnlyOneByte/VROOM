import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';
import { odometerOrderError } from '../validation';

let ctx: TestApp;
let vehicleId: string;

beforeEach(async () => {
  ctx = await createTestApp();
  vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
});
afterEach(() => ctx.close());

function fillUp(date: string, mileage: number | null, extra: Record<string, unknown> = {}) {
  return ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'fuel',
    expenseAmount: 40,
    date,
    volume: 10,
    fuelType: 'Regular',
    mileage,
    ...extra,
  });
}

async function created(date: string, mileage: number): Promise<string> {
  const res = await fillUp(date, mileage);
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.id;
}

async function rejection(res: Response): Promise<string> {
  const body = await json<{ message?: string; error?: { message?: string } }>(res);
  expect(res.status, JSON.stringify(body)).toBe(400);
  return body.error?.message ?? body.message ?? '';
}

describe('the odometer reading must fit between the entries around its date', () => {
  test('readings in date order are accepted, whatever order they are logged in', async () => {
    await created('2024-03-01', 10_000);
    await created('2024-03-20', 10_800);
    await created('2024-03-10', 10_400);
  });

  test('a reading at or below an earlier entry is refused with a readable message', async () => {
    await created('2024-03-01', 10_000);
    expect(await rejection(await fillUp('2024-03-10', 9_000))).toBe(
      'Mileage must be greater than 10,000 (from earlier entry)'
    );
    expect(await rejection(await fillUp('2024-03-10', 10_000))).toContain('greater than 10,000');
  });

  test('a reading at or above a later entry is refused', async () => {
    await created('2024-03-20', 10_800);
    expect(await rejection(await fillUp('2024-03-10', 10_900))).toBe(
      'Mileage must be less than 10,800 (from later entry)'
    );
    expect(await rejection(await fillUp('2024-03-10', 10_800))).toContain('less than 10,800');
  });

  test('entries on the same day are not compared, matching the form', async () => {
    await created('2024-03-10', 10_400);
    await created('2024-03-10', 10_100);
  });

  test('every reading on the nearest earlier and later day bounds it, whatever its time', async () => {
    await created('2024-03-10T11:00:00.000Z', 10_400);
    await created('2024-03-10T17:00:00.000Z', 10_100);
    await created('2024-03-20T08:00:00.000Z', 11_000);
    await created('2024-03-20T20:00:00.000Z', 11_500);

    expect(await rejection(await fillUp('2024-03-15', 10_200))).toContain('greater than 10,400');
    expect(await rejection(await fillUp('2024-03-15', 11_200))).toContain('less than 11,000');
    await created('2024-03-15', 10_500);
  });

  test('only the nearest earlier day is compared, so an old bad reading does not block new fill-ups', async () => {
    const old = await created('2020-01-01', 1);
    await created('2021-01-01', 5_000);
    ctx.sqlite.query('UPDATE expenses SET mileage = 999999 WHERE id = ?').run(old);

    await created('2024-03-10', 10_400);
  });

  test('the first reading for a vehicle is accepted', async () => {
    await created('2024-03-10', 1);
  });

  test('an update that moves the date across other entries is checked at its new date', async () => {
    await created('2024-03-01', 10_000);
    await created('2024-03-20', 10_800);
    const id = await created('2024-03-10', 10_400);

    const moved = await ctx.authed('PUT', `/api/v1/expenses/${id}`, { date: '2024-03-25' });
    expect(await rejection(moved)).toBe('Mileage must be greater than 10,800 (from earlier entry)');

    const fixed = await ctx.authed('PUT', `/api/v1/expenses/${id}`, {
      date: '2024-03-25',
      mileage: 11_000,
    });
    expect(fixed.status).toBe(200);
  });

  test('an update that leaves the reading, date and vehicle alone is not re-checked', async () => {
    await created('2024-03-01', 10_000);
    const id = await created('2024-03-10', 10_400);
    ctx.sqlite.query('UPDATE expenses SET mileage = 9000 WHERE id = ?').run(id);

    const res = await ctx.authed('PUT', `/api/v1/expenses/${id}`, { description: 'Shell' });
    expect(res.status).toBe(200);
  });

  test('a replay of an already saved entry is not refused', async () => {
    const earlier = await created('2024-03-01', 10_000);
    const first = await fillUp('2024-03-10', 10_400, { clientId: 'client-1' });
    const firstBody = await json<DataEnvelope<{ id: string }>>(first);
    expect(first.status).toBe(201);
    ctx.sqlite.query('UPDATE expenses SET mileage = 11000 WHERE id = ?').run(earlier);

    const replay = await fillUp('2024-03-10', 10_400, { clientId: 'client-1' });
    const replayBody = await json<DataEnvelope<{ id: string }>>(replay);
    expect(replay.status, JSON.stringify(replayBody)).toBeLessThan(300);
    expect(replayBody.data.id).toBe(firstBody.data.id);
  });

  test('days are local to the sender when it sends its time zone', async () => {
    await created('2024-03-10T12:00:00.000Z', 10_000);
    const lateEvening = '2024-03-10T10:00:00.000Z';

    expect(
      await rejection(await fillUp(lateEvening, 10_500, { timeZone: 'Pacific/Auckland' }))
    ).toBe('Mileage must be less than 10,000 (from later entry)');
    expect((await fillUp(lateEvening, 10_500)).status).toBe(201);
  });

  test('two entries on one local day are not compared, even across a UTC midnight', async () => {
    await created('2024-02-10T20:00:00.000Z', 10_000);
    const sameEvening = '2024-02-11T06:00:00.000Z';

    expect(await rejection(await fillUp(sameEvening, 9_900))).toContain('greater than 10,000');
    const res = await fillUp(sameEvening, 9_900, { timeZone: 'America/Los_Angeles' });
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status).toBe(201);

    const edited = await ctx.authed('PUT', `/api/v1/expenses/${body.data.id}`, {
      mileage: 9_800,
      timeZone: 'America/Los_Angeles',
    });
    expect(edited.status).toBe(200);
    const unzoned = await ctx.authed('PUT', `/api/v1/expenses/${body.data.id}`, { mileage: 9_700 });
    expect(await rejection(unzoned)).toContain('greater than 10,000');
  });

  test('an unknown time zone is refused', async () => {
    expect(
      await rejection(await fillUp('2024-03-10', 10_000, { timeZone: 'Mars/Olympus' }))
    ).toContain('Unknown time zone');
  });

  test('the time zone is not an edited field, so locked insurance and split entries still take a description', async () => {
    const id = await created('2024-03-10', 10_000);
    const editDescription = (description: string) =>
      ctx.authed('PUT', `/api/v1/expenses/${id}`, { description, timeZone: 'Pacific/Auckland' });

    ctx.sqlite
      .query(
        "UPDATE expenses SET source_type = 'insurance_term', source_id = 'term-1' WHERE id = ?"
      )
      .run(id);
    expect((await editDescription('Premium')).status).toBe(200);

    ctx.sqlite
      .query(
        "UPDATE expenses SET source_type = NULL, source_id = NULL, group_id = 'g-1' WHERE id = ?"
      )
      .run(id);
    expect((await editDescription('Shared')).status).toBe(200);
  });

  test('two conflicting saves sent at once cannot both be stored', async () => {
    const statuses = await Promise.all([
      fillUp('2024-03-01', 10_000).then((r) => r.status),
      fillUp('2024-03-20', 9_000).then((r) => r.status),
    ]);
    expect(statuses.sort()).toEqual([201, 400]);
  });

  test('two conflicting edits sent at once cannot both be stored', async () => {
    const early = await created('2024-03-01', 10_000);
    const late = await created('2024-03-20', 11_000);
    const statuses = await Promise.all([
      ctx.authed('PUT', `/api/v1/expenses/${early}`, { mileage: 10_500 }).then((r) => r.status),
      ctx.authed('PUT', `/api/v1/expenses/${late}`, { mileage: 10_200 }).then((r) => r.status),
    ]);
    expect(statuses.sort()).toEqual([200, 400]);
  });
});

describe('the odometer check sees what the form sees', () => {
  async function misc(date: string, mileage?: number) {
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 5,
      date,
      ...(mileage !== undefined && { mileage }),
    });
    expect(res.status).toBe(201);
  }

  test('a non-fuel entry carrying a mileage is never checked', async () => {
    await created('2024-03-01', 10_000);
    await misc('2024-03-10', 5);
  });

  test('readings are found however many entries without a mileage sit between them', async () => {
    await created('2022-12-01', 10_000);
    await created('2024-06-01', 12_000);
    for (let day = 1; day <= 101; day++) {
      await misc(
        `2023-${String(Math.ceil(day / 28)).padStart(2, '0')}-${String(((day - 1) % 28) + 1).padStart(2, '0')}`
      );
    }

    expect(await rejection(await fillUp('2024-03-10', 9_500))).toContain('greater than 10,000');
    expect(await rejection(await fillUp('2023-01-10', 12_500))).toContain('less than 12,000');
    await created('2024-03-10', 11_000);
  });

  test('moving a fill-up to another vehicle is checked against that vehicle', async () => {
    const id = await created('2024-03-10', 10_400);
    const other = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2020 });
    const theirs = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId: other,
      category: 'fuel',
      expenseAmount: 40,
      date: '2024-03-01',
      volume: 10,
      fuelType: 'Regular',
      mileage: 50_000,
    });
    expect(theirs.status).toBe(201);

    const moved = await ctx.authed('PUT', `/api/v1/expenses/${id}`, { vehicleId: other });
    expect(await rejection(moved)).toBe('Mileage must be greater than 50,000 (from earlier entry)');
  });

  test('turning an entry into a fill-up checks its reading', async () => {
    await created('2024-03-01', 10_000);
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 5,
      date: '2024-03-10',
    });
    const body = await json<DataEnvelope<{ id: string }>>(res);
    const turned = await ctx.authed('PUT', `/api/v1/expenses/${body.data.id}`, {
      category: 'fuel',
      volume: 10,
      fuelType: 'Regular',
      mileage: 9_000,
    });
    expect(await rejection(turned)).toContain('greater than 10,000');
  });
});

describe('odometerOrderError', () => {
  const none = { before: null, after: null };

  test('no neighbouring readings means no error', () => {
    expect(odometerOrderError(5, none)).toBeNull();
  });

  test('a reading below the vehicle initial mileage is refused', () => {
    expect(odometerOrderError(900, none, 1_000)).toBe(
      'Mileage cannot be less than initial mileage'
    );
    expect(odometerOrderError(1_000, none, 1_000)).toBeNull();
  });

  test('the earlier and later readings bound it, exclusive', () => {
    const neighbours = { before: 300, after: 700 };
    expect(odometerOrderError(301, neighbours)).toBeNull();
    expect(odometerOrderError(300, neighbours)).toContain('greater than 300');
    expect(odometerOrderError(700, neighbours)).toContain('less than 700');
  });
});
