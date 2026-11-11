// The businessMileageRate setting must survive a backup and restore. A configured reimbursement rate
// must not silently reset to 0.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, json, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

function rateRow(): { business_mileage_rate: number } {
  return ctx.sqlite
    .query('SELECT business_mileage_rate FROM user_preferences WHERE user_id = ?')
    .get(ctx.user.id) as { business_mileage_rate: number };
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
    // Set through the settings route, which also creates the prefs row.
    const put = await ctx.authed('PUT', '/api/v1/settings', { businessMileageRate: 0.67 });
    expect(put.status, await put.text()).toBe(200);
    expect(rateRow().business_mileage_rate).toBe(0.67);

    await roundTrip();

    expect(rateRow().business_mileage_rate).toBe(0.67);
  });

  test('the default rate round-trips as 0 (control — no spurious change)', async () => {
    // Touch settings so the prefs row exists with the column default.
    await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: 'USD' });
    expect(rateRow().business_mileage_rate).toBe(0);

    await roundTrip();

    expect(rateRow().business_mileage_rate).toBe(0);
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
