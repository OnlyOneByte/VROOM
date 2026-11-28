import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
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

async function rateRow(): Promise<{ business_mileage_rate: number }> {
  return (await ctx.sql.get(
    'SELECT business_mileage_rate FROM user_preferences WHERE user_id = ?',
    [ctx.user.id]
  )) as { business_mileage_rate: number };
}

async function roundTrip(): Promise<void> {
  const { backupService } = await import('../backup');
  const { restoreService } = await import('../restore');
  const zip = await backupService.exportAsZip(ctx.user.id);
  const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
  expect(result.success, JSON.stringify(result)).toBe(true);
}

describe('backup → restore round-trip preserves businessMileageRate', () => {
  test('a non-zero fractional rate survives a full export→restore (not reset to 0)', async () => {
    const put = await ctx.authed('PUT', '/api/v1/settings', { businessMileageRate: 0.67 });
    expect(put.status, await put.text()).toBe(200);
    expect((await rateRow()).business_mileage_rate).toBe(0.67);

    await roundTrip();

    expect((await rateRow()).business_mileage_rate).toBe(0.67);
  });

  test('the default rate round-trips as 0 (control — no spurious change)', async () => {
    await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: 'USD' });
    expect((await rateRow()).business_mileage_rate).toBe(0);

    await roundTrip();

    expect((await rateRow()).business_mileage_rate).toBe(0);
  });

  test('a paired sibling pref (currencyUnit) survives alongside the rate (no field dropped)', async () => {
    await ctx.authed('PUT', '/api/v1/settings', {
      businessMileageRate: 0.5,
      currencyUnit: 'EUR',
    });

    await roundTrip();

    const prefs = await json<{ data: { businessMileageRate: number; currencyUnit: string } }>(
      await ctx.authed('GET', '/api/v1/settings')
    );
    expect(prefs.data.businessMileageRate).toBe(0.5);
    expect(prefs.data.currencyUnit).toBe('EUR');
  });
});
