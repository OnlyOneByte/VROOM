/**
 * Theming engine spec T2 — PUT/GET /settings `themePreference` field, through the REAL HTTP stack.
 *
 * T1 (C174) added the `userPreferences.theme_preference` column (NOT NULL DEFAULT 'default'). T2 wires
 * it into the settings route with an EXPLICIT bounded schema field (`z.string().min(1).max(64)`) instead
 * of the unbounded string createInsertSchema would otherwise derive from a plain-text column. These tests
 * pin the contract end-to-end:
 *   - GET returns the column default ('default') for a fresh user;
 *   - a PUT persists a theme id and GET round-trips it;
 *   - the merge is per-field (the #82 discipline): setting the theme leaves sibling prefs untouched, and a
 *     sibling PUT (currencyUnit) leaves the theme untouched — neither wholesale-overwrites the row;
 *   - the bound rejects an over-long (>64) id and an empty id (a storage/abuse guard, not an allow-list:
 *     the resolver treats an unknown id as 'default', so any <=64-char value is safe to store).
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules — keep imports to the harness + bun:test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, json, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface SettingsBody {
  success: boolean;
  data: { themePreference: string; currencyUnit: string };
}

async function getSettings(): Promise<SettingsBody['data']> {
  const res = await ctx.authed('GET', '/api/v1/settings');
  return (await json<SettingsBody>(res)).data;
}

describe('PUT/GET /settings themePreference (theming-engine T2)', () => {
  test("a fresh user's themePreference defaults to 'default' (the T1 column default)", async () => {
    const data = await getSettings();
    expect(data.themePreference).toBe('default');
  });

  test('a PUT persists themePreference and GET round-trips it', async () => {
    const res = await ctx.authed('PUT', '/api/v1/settings', { themePreference: 'instrument' });
    const body = await json<SettingsBody>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.themePreference).toBe('instrument');
    // GET reflects the persisted value (not just the PUT echo).
    expect((await getSettings()).themePreference).toBe('instrument');
  });

  test('setting themePreference leaves sibling prefs untouched (per-field merge, #82)', async () => {
    // Establish a non-default sibling first.
    await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: 'EUR' });
    // Now PUT only the theme — currency must survive.
    await ctx.authed('PUT', '/api/v1/settings', { themePreference: 'instrument' });
    const data = await getSettings();
    expect(data.themePreference).toBe('instrument');
    expect(data.currencyUnit).toBe('EUR'); // not wiped by the theme-only PUT
  });

  test('a sibling PUT (currencyUnit) leaves a previously-set themePreference untouched', async () => {
    await ctx.authed('PUT', '/api/v1/settings', { themePreference: 'instrument' });
    await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: 'GBP' });
    const data = await getSettings();
    expect(data.currencyUnit).toBe('GBP');
    expect(data.themePreference).toBe('instrument'); // not reset to 'default' by the currency PUT
  });

  test('an over-long themePreference (>64 chars) is rejected (400, storage/abuse bound)', async () => {
    const res = await ctx.authed('PUT', '/api/v1/settings', {
      themePreference: 'x'.repeat(65),
    });
    expect(res.status).toBe(400);
    // The stored value is unchanged (still the default), not the rejected over-long id.
    expect((await getSettings()).themePreference).toBe('default');
  });

  test('an empty themePreference is rejected (400) — a blank id is not a valid theme', async () => {
    const res = await ctx.authed('PUT', '/api/v1/settings', { themePreference: '' });
    expect(res.status).toBe(400);
    expect((await getSettings()).themePreference).toBe('default');
  });

  test('an omitted themePreference is a no-op (a normal unrelated PUT does not touch it)', async () => {
    await ctx.authed('PUT', '/api/v1/settings', { themePreference: 'instrument' });
    // A PUT that does not mention themePreference must leave it as-is.
    await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: 'USD' });
    expect((await getSettings()).themePreference).toBe('instrument');
  });
});
