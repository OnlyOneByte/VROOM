import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, json, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

interface CommunitySettings {
  communityStatsOptIn: boolean;
  communityStatsConsentedAt: string | null;
  communityRegion: string | null;
  currencyUnit: string;
}

async function getSettings(): Promise<CommunitySettings> {
  const res = await ctx.authed('GET', '/api/v1/settings');
  return (await json<{ data: CommunitySettings }>(res)).data;
}

async function put(body: Record<string, unknown>): Promise<Response> {
  return ctx.authed('PUT', '/api/v1/settings', body);
}

describe('community stats consent and region settings', () => {
  test('a new user starts opted out with no region', async () => {
    const data = await getSettings();
    expect(data.communityStatsOptIn).toBe(false);
    expect(data.communityStatsConsentedAt).toBeNull();
    expect(data.communityRegion).toBeNull();
  });

  test('a PUT round-trips opt-in and region through GET', async () => {
    const res = await put({ communityStatsOptIn: true, communityRegion: 'US-CA' });
    expect(res.status, await res.clone().text()).toBe(200);
    const data = await getSettings();
    expect(data.communityStatsOptIn).toBe(true);
    expect(data.communityRegion).toBe('US-CA');
  });

  test('a country-only region and clearing the region both work', async () => {
    expect((await put({ communityRegion: 'DE' })).status).toBe(200);
    expect((await getSettings()).communityRegion).toBe('DE');
    expect((await put({ communityRegion: null })).status).toBe(200);
    expect((await getSettings()).communityRegion).toBeNull();
  });

  test.each(['ZZ', 'us', 'US-XX', 'USA', 'EU', ''])(
    'the unknown region %p is rejected and nothing is stored',
    async (region) => {
      const res = await put({ communityRegion: region });
      expect(res.status).toBe(400);
      expect((await getSettings()).communityRegion).toBeNull();
    }
  );

  test('turning the toggle on stamps consentedAt and turning it off clears it', async () => {
    const before = Date.now() - 1000;
    await put({ communityStatsOptIn: true });
    const on = await getSettings();
    expect(on.communityStatsConsentedAt).not.toBeNull();
    expect(new Date(on.communityStatsConsentedAt as string).getTime()).toBeGreaterThanOrEqual(
      before
    );

    await put({ communityStatsOptIn: false });
    const off = await getSettings();
    expect(off.communityStatsOptIn).toBe(false);
    expect(off.communityStatsConsentedAt).toBeNull();
  });

  test('re-sending opt-in keeps the original consent stamp', async () => {
    await put({ communityStatsOptIn: true });
    const first = (await getSettings()).communityStatsConsentedAt;
    await Bun.sleep(1100);
    await put({ communityStatsOptIn: true, currencyUnit: 'EUR' });
    expect((await getSettings()).communityStatsConsentedAt).toBe(first);
  });

  test('a client cannot set consentedAt directly', async () => {
    await put({ communityStatsConsentedAt: '2020-01-01T00:00:00.000Z' });
    expect((await getSettings()).communityStatsConsentedAt).toBeNull();
  });

  test('an unrelated PUT leaves consent untouched', async () => {
    await put({ communityStatsOptIn: true, communityRegion: 'GB' });
    await put({ currencyUnit: 'GBP' });
    const data = await getSettings();
    expect(data.communityStatsOptIn).toBe(true);
    expect(data.communityRegion).toBe('GB');
  });
});
