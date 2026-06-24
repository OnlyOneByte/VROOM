/**
 * TRUE backup → restore round-trip for the theming-engine `themePreference` field (spec T3), through the
 * REAL exportAsZip (CSV serialize) → restoreFromBackup (CSV parse + coerceRow + FK-ordered insert) stack.
 *
 * Certifies the C174 (column + migration + Sheets header) / C175 (coerceRow NOT-NULL-default safety) /
 * C179 (bounded settings field) persistence arc end-to-end: a user's selected theme id must survive a
 * full backup→restore, NOT silently reset to 'default'. The CSV column set is schema-derived
 * (getTableColumns), so themePreference rides along automatically — this proves it actually does, and
 * guards the NOT-NULL-default coerce path (C175) against a regression that would re-null an empty cell
 * and abort the whole restore (NORTH_STAR #1).
 *
 * createTestApp() rewrites env then dynamic-imports DB-bound modules, so backup/restore are imported
 * dynamically AFTER it (mirrors maintenance-fields-roundtrip.test.ts).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, json, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

function themeRow(): { theme_preference: string } {
  return ctx.sqlite
    .query('SELECT theme_preference FROM user_preferences WHERE user_id = ?')
    .get(ctx.user.id) as { theme_preference: string };
}

async function roundTrip(): Promise<void> {
  const { backupService } = await import('../backup');
  const { restoreService } = await import('../restore');
  const zip = await backupService.exportAsZip(ctx.user.id);
  const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
  expect(result.success, JSON.stringify(result)).toBe(true);
}

describe('backup → restore round-trip preserves themePreference (theming-engine T3)', () => {
  test('a non-default theme id survives a full export→restore (not reset to default)', async () => {
    // Set a non-default theme through the REAL settings route (the C179 path), creating the prefs row.
    const put = await ctx.authed('PUT', '/api/v1/settings', { themePreference: 'instrument' });
    expect(put.status, await put.text()).toBe(200);
    expect(themeRow().theme_preference).toBe('instrument');

    await roundTrip();

    // The selected theme survived the CSV serialize → coerce → re-insert; NOT silently reset to default.
    expect(themeRow().theme_preference).toBe('instrument');
  });

  test("the default theme round-trips as 'default' (control — no spurious change)", async () => {
    // Touch settings so the prefs row exists with the column default.
    await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: 'USD' });
    expect(themeRow().theme_preference).toBe('default');

    await roundTrip();

    expect(themeRow().theme_preference).toBe('default');
  });

  test('a paired sibling pref (currencyUnit) survives alongside the theme (no field dropped)', async () => {
    await ctx.authed('PUT', '/api/v1/settings', {
      themePreference: 'instrument',
      currencyUnit: 'EUR',
    });

    await roundTrip();

    const prefs = await json<{ data: { themePreference: string; currencyUnit: string } }>(
      await ctx.authed('GET', '/api/v1/settings')
    );
    expect(prefs.data.themePreference).toBe('instrument');
    expect(prefs.data.currencyUnit).toBe('EUR');
  });
});
