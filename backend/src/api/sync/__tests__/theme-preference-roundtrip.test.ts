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

describe('backup → restore round-trip preserves themePreference', () => {
  test('a non-default theme id survives a full export→restore (not reset to default)', async () => {
    const put = await ctx.authed('PUT', '/api/v1/settings', { themePreference: 'instrument' });
    expect(put.status, await put.text()).toBe(200);
    expect(themeRow().theme_preference).toBe('instrument');

    await roundTrip();

    expect(themeRow().theme_preference).toBe('instrument');
  });

  test("the default theme round-trips as 'default' (control — no spurious change)", async () => {
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
