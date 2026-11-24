import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../../../config';
import { createTestApp, json, type TestApp } from '../../../test-helpers/http-client';

const BACKEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const communityConfig = CONFIG.communityStats as { mode: 'off' | 'local' };

async function loadConfig(env: Record<string, string>) {
  const proc = Bun.spawn(
    [process.execPath, '--env-file=/dev/null', '-e', "await import('./src/config.ts')"],
    {
      cwd: BACKEND_ROOT,
      env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', ...env },
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, output: `${stdout}${stderr}` };
}

describe('community stats server settings', () => {
  test.each(['5', '9', '0', '10.5', 'ten'])(
    'COMMUNITY_STATS_MIN_GROUP=%p stops startup with a clear message',
    async (value) => {
      const { code, output } = await loadConfig({ COMMUNITY_STATS_MIN_GROUP: value });
      expect(code).not.toBe(0);
      expect(output).toContain('COMMUNITY_STATS_MIN_GROUP must be a whole number of at least 10');
    }
  );

  test('a raised minimum group and an unknown mode are handled', async () => {
    expect((await loadConfig({ COMMUNITY_STATS_MIN_GROUP: '25' })).code).toBe(0);
    expect((await loadConfig({ COMMUNITY_STATS: 'global' })).code).not.toBe(0);
  });

  test('defaults are local with a minimum group of 10 and quartiles from 20', () => {
    expect(CONFIG.communityStats.mode).toBe('local');
    expect(CONFIG.communityStats.minGroup).toBe(10);
    expect(CONFIG.communityStats.quartileMinGroup).toBe(20);
    expect(CONFIG.communityStats.enabled).toBe(false);
  });
});

describe('settings response carries the server mode', () => {
  let ctx: TestApp;

  beforeEach(async () => {
    ctx = await createTestApp();
  });
  afterEach(() => {
    communityConfig.mode = 'local';
    ctx.close();
  });

  async function mode(): Promise<string | undefined> {
    const res = await ctx.authed('GET', '/api/v1/settings');
    return (await json<{ data: { communityStatsMode?: string } }>(res)).data.communityStatsMode;
  }

  test('GET and PUT report local by default and off when switched off', async () => {
    expect(await mode()).toBe('local');
    const put = await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: 'EUR' });
    expect(
      (await json<{ data: { communityStatsMode?: string } }>(put)).data.communityStatsMode
    ).toBe('local');
    communityConfig.mode = 'off';
    expect(await mode()).toBe('off');
  });

  test('a client cannot write the server mode', async () => {
    await ctx.authed('PUT', '/api/v1/settings', { communityStatsMode: 'off' });
    expect(await mode()).toBe('local');
  });
});
