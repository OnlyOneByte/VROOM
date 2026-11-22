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
});

describe('odometerOrderError', () => {
  const at = (day: string) => new Date(`${day}T12:00:00.000Z`);

  test('no other readings, or only readings without a value, means no error', () => {
    expect(odometerOrderError(5, at('2024-01-01'), [])).toBeNull();
    expect(
      odometerOrderError(5, at('2024-01-01'), [{ id: 'a', date: at('2023-01-01'), mileage: null }])
    ).toBeNull();
  });

  test('a reading below the vehicle initial mileage is refused', () => {
    expect(odometerOrderError(900, at('2024-01-01'), [], 1_000)).toBe(
      'Mileage cannot be less than initial mileage'
    );
    expect(odometerOrderError(1_000, at('2024-01-01'), [], 1_000)).toBeNull();
  });

  test('the highest earlier and lowest later readings bound it, exclusive', () => {
    const others = [
      { id: 'a', date: at('2024-01-01'), mileage: 100 },
      { id: 'b', date: at('2024-01-05'), mileage: 300 },
      { id: 'c', date: at('2024-02-01'), mileage: 900 },
      { id: 'd', date: at('2024-03-01'), mileage: 700 },
    ];
    expect(odometerOrderError(301, at('2024-01-10'), others)).toBeNull();
    expect(odometerOrderError(300, at('2024-01-10'), others)).toContain('greater than 300');
    expect(odometerOrderError(700, at('2024-01-10'), others)).toContain('less than 700');
  });
});
