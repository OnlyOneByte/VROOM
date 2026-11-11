/**
 * themePreference through the HTTP stack: the 'default' column default, a per-field merge that leaves
 * sibling preferences alone, and the length bound. The bound is an abuse guard, not an allow-list.
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

describe('PUT/GET /settings themePreference', () => {
  test("a fresh user's themePreference defaults to 'default'", async () => {
    const data = await getSettings();
    expect(data.themePreference).toBe('default');
  });

  test('a PUT persists themePreference and GET round-trips it', async () => {
    const res = await ctx.authed('PUT', '/api/v1/settings', { themePreference: 'instrument' });
    const body = await json<SettingsBody>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.themePreference).toBe('instrument');
    expect((await getSettings()).themePreference).toBe('instrument');
  });

  test('setting themePreference leaves sibling prefs untouched (per-field merge)', async () => {
    await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: 'EUR' });
    await ctx.authed('PUT', '/api/v1/settings', { themePreference: 'instrument' });
    const data = await getSettings();
    expect(data.themePreference).toBe('instrument');
    expect(data.currencyUnit).toBe('EUR');
  });

  test('a sibling PUT leaves a previously set themePreference untouched', async () => {
    await ctx.authed('PUT', '/api/v1/settings', { themePreference: 'instrument' });
    await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: 'GBP' });
    const data = await getSettings();
    expect(data.currencyUnit).toBe('GBP');
    expect(data.themePreference).toBe('instrument');
  });

  test('an over-long themePreference (>64 chars) is rejected', async () => {
    const res = await ctx.authed('PUT', '/api/v1/settings', {
      themePreference: 'x'.repeat(65),
    });
    expect(res.status).toBe(400);
    expect((await getSettings()).themePreference).toBe('default');
  });

  test('an empty themePreference is rejected', async () => {
    const res = await ctx.authed('PUT', '/api/v1/settings', { themePreference: '' });
    expect(res.status).toBe(400);
    expect((await getSettings()).themePreference).toBe('default');
  });

  test('an unrelated PUT leaves themePreference unchanged', async () => {
    await ctx.authed('PUT', '/api/v1/settings', { themePreference: 'instrument' });
    await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: 'USD' });
    expect((await getSettings()).themePreference).toBe('instrument');
  });
});
