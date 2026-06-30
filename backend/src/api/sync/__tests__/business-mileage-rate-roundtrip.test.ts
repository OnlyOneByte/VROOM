/**
 * TRUE backup → restore round-trip for the trips-location `businessMileageRate` field (T8), through the
 * REAL exportAsZip (CSV serialize) → restoreFromBackup (CSV parse + coerceRow + FK-ordered insert) stack.
 *
 * T8 (migration 0008 + the bounded settings field + the SHEET_HEADERS entry) persists the user's DEFAULT
 * business-mileage rate ($/mile) that the trip mileage-summary consumes. The CSV column set is
 * schema-derived (getTableColumns), so businessMileageRate rides along automatically — T8 asserted that
 * INDIRECTLY (the sheets-header-coverage guard proves the HEADER exists). This proves the VALUE actually
 * survives a full backup→restore: a configured reimbursement rate must NOT silently reset to 0 (a
 * NORTH_STAR #1 data-loss — the user's mileage-summary $ would silently zero out after a restore). Mirrors
 * the C180 themePreference round-trip; complements it on the money-adjacent sibling field.
 *
 * createTestApp() rewrites env then dynamic-imports DB-bound modules, so backup/restore are imported
 * dynamically AFTER it (mirrors theme-preference-roundtrip.test.ts).
 */

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

describe('backup → restore round-trip preserves businessMileageRate (trips-location T8)', () => {
  test('a non-zero fractional rate survives a full export→restore (not reset to 0)', async () => {
    // Set the rate through the REAL settings route (the T8 path), creating the prefs row.
    const put = await ctx.authed('PUT', '/api/v1/settings', { businessMileageRate: 0.67 });
    expect(put.status, await put.text()).toBe(200);
    expect(rateRow().business_mileage_rate).toBe(0.67);

    await roundTrip();

    // The configured rate survived the CSV serialize → coerce → re-insert; NOT silently reset to 0.
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
