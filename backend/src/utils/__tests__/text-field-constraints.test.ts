import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../test-helpers/http-client';
import { seedVehicle } from '../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function status(method: string, path: string, body: unknown): Promise<number> {
  const res = await ctx.authed(method, path, body);
  await res.text();
  return res.status;
}

const vehicle = (extra: Record<string, unknown>) => ({
  make: 'Toyota',
  model: 'Camry',
  year: 2022,
  ...extra,
});

describe('vehicle text fields', () => {
  test.each([
    [{ vehicleType: 'electric' }, 201],
    [{ vehicleType: 'spaceship' }, 400],
    [{ vin: '' }, 201],
    [{ vin: '1HGCM82633A004352' }, 201],
    [{ vin: 'X'.repeat(10_000) }, 400],
    [{ vin: 'SHORT' }, 400],
  ])('%p gives %p', async (extra, expected) => {
    expect(await status('POST', '/api/v1/vehicles', vehicle(extra))).toBe(expected);
  });
});

describe('financing type and payment frequency', () => {
  const financing = (extra: Record<string, unknown>) => ({
    financingType: 'loan',
    provider: 'TestBank',
    originalAmount: 20000,
    termMonths: 60,
    startDate: '2024-01-01T00:00:00.000Z',
    paymentAmount: 400,
    apr: 5,
    ...extra,
  });

  test.each([
    [{ financingType: 'lease', paymentFrequency: 'bi-weekly' }, 201],
    [{ financingType: 'gift' }, 400],
    [{ paymentFrequency: 'hourly' }, 400],
  ])('%p gives %p', async (extra, expected) => {
    const vehicleId = await seedVehicle(ctx);
    const path = `/api/v1/financing/vehicles/${vehicleId}/financing`;
    expect(await status('POST', path, financing(extra))).toBe(expected);
  });
});

describe('settings currency', () => {
  test.each([
    ['JPY', 200],
    ['EUR', 200],
    ['ZZZ', 400],
    ['X'.repeat(10_000), 400],
  ])('%p gives %p', async (currencyUnit, expected) => {
    expect(await status('PUT', '/api/v1/settings', { currencyUnit })).toBe(expected);
  });
});

describe('expense fuel type', () => {
  test.each([
    ['premium', 201],
    ['X'.repeat(5_000), 400],
  ])('%p gives %p', async (fuelType, expected) => {
    const vehicleId = await seedVehicle(ctx);
    const body = {
      vehicleId,
      category: 'fuel',
      expenseAmount: 50,
      date: '2024-02-01T12:00:00.000Z',
      mileage: 1000,
      volume: 10,
      fuelType,
    };
    expect(await status('POST', '/api/v1/expenses', body)).toBe(expected);
  });
});
