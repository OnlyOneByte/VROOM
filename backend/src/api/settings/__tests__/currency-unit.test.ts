import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import SHARED_CURRENCIES from '../../../shared-currencies.json';
import {
  createTestApp,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function savedCurrency(): Promise<string> {
  const res = await ctx.authed('GET', '/api/v1/settings');
  return (await json<{ data: { currencyUnit: string } }>(res)).data.currencyUnit;
}

describe('shared-currencies.json', () => {
  const codes = SHARED_CURRENCIES.currencies;

  test('is a sorted list of unique ISO-shaped codes', () => {
    expect(codes.every((c) => /^[A-Z]{3}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
    expect([...codes].sort()).toEqual(codes);
  });

  test('holds no 3-decimal currency', () => {
    for (const code of codes) {
      const digits = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
      }).resolvedOptions().maximumFractionDigits;
      expect([0, 2].includes(digits ?? -1), code).toBe(true);
    }
  });
});

describe('PUT /settings currencyUnit', () => {
  test.each(['JPY', 'EUR', 'ZWG', 'XCG'])('accepts %s from the shared list', async (code) => {
    const res = await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: code });
    expect(res.status).toBe(200);
    expect(await savedCurrency()).toBe(code);
  });

  test.each([
    ['HRK', 'replaced by the euro'],
    ['BGN', 'replaced by the euro in 2026'],
    ['DEM', 'historic, known to Bun only'],
    ['XDR', 'not a spendable currency'],
    ['BHD', '3 decimals'],
    ['ABC', 'not a currency'],
  ])('rejects %s (%s) and keeps the saved currency', async (code) => {
    const res = await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: code });
    expect(res.status).toBe(400);
    expect(await savedCurrency()).toBe('USD');
  });
});
