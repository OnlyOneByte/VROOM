import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

interface ConsentRow {
  community_stats_opt_in: number;
  community_stats_consented_at: number | null;
  community_region: string | null;
}

async function consentRow(): Promise<ConsentRow> {
  return (await ctx.sql.get(
    'SELECT community_stats_opt_in, community_stats_consented_at, community_region FROM user_preferences WHERE user_id = ?',
    [ctx.user.id]
  )) as ConsentRow;
}

async function roundTrip(): Promise<void> {
  const { backupService } = await import('../backup');
  const { restoreService } = await import('../restore');
  const zip = await backupService.exportAsZip(ctx.user.id);
  const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
  expect(result.success, JSON.stringify(result)).toBe(true);
}

describe('backup → restore never carries community stats consent', () => {
  test('a backup taken while opted in restores opted out, keeping the region', async () => {
    const res = await ctx.authed('PUT', '/api/v1/settings', {
      communityStatsOptIn: true,
      communityRegion: 'CA-ON',
    });
    expect(res.status, await res.text()).toBe(200);
    expect((await consentRow()).community_stats_opt_in).toBe(1);
    expect((await consentRow()).community_stats_consented_at).not.toBeNull();

    await roundTrip();

    expect(await consentRow()).toEqual({
      community_stats_opt_in: 0,
      community_stats_consented_at: null,
      community_region: 'CA-ON',
    });
  });

  test('an unknown region in a backup is dropped on restore', async () => {
    await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: 'USD' });
    await ctx.sql.run('UPDATE user_preferences SET community_region = ? WHERE user_id = ?', [
      'XX-NOPE',
      ctx.user.id,
    ]);

    await roundTrip();

    expect((await consentRow()).community_region).toBeNull();
  });
});
