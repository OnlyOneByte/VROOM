import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../../../config';
import { createTestApp, json, type TestApp } from '../../../test-helpers/http-client';

const BACKEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const communityConfig = CONFIG.communityStats as { mode: 'off' | 'local' };

async function loadConfig(env: Record<string, string>) {
  const script =
    "const { CONFIG } = await import('./src/config.ts'); console.log(JSON.stringify(CONFIG.communityStats))";
  const proc = Bun.spawn([process.execPath, '--env-file=/dev/null', '-e', script], {
    cwd: BACKEND_ROOT,
    env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return {
    code: await proc.exited,
    output: `${stdout}${stderr}`,
    config: () => JSON.parse(stdout.trim().split('\n').at(-1) ?? 'null'),
  };
}

describe('community stats server settings', () => {
  test.each(['5', '10', '19', '0', '20.5', 'twenty'])(
    'COMMUNITY_STATS_MIN_GROUP=%p stops startup with a clear message',
    async (value) => {
      const { code, output } = await loadConfig({ COMMUNITY_STATS_MIN_GROUP: value });
      expect(code).not.toBe(0);
      expect(output).toContain('COMMUNITY_STATS_MIN_GROUP must be a whole number of at least 20');
    }
  );

  test.each([
    ['20', 20],
    ['45', 45],
  ])('a threshold of %p is accepted', async (value, expected) => {
    const { code, config } = await loadConfig({ COMMUNITY_STATS_MIN_GROUP: value });
    expect(code).toBe(0);
    expect(config()).toMatchObject({ minGroup: expected });
  });

  test('an unknown mode stops startup naming the variable', async () => {
    const { code, output } = await loadConfig({ COMMUNITY_STATS: 'global' });
    expect(code).not.toBe(0);
    expect(output).toContain('COMMUNITY_STATS');
  });

  test('defaults are local with a publication threshold of 30', async () => {
    const { code, config } = await loadConfig({});
    expect(code).toBe(0);
    expect(config()).toMatchObject({
      mode: 'local',
      minGroup: 30,
      enabled: false,
    });
  });
});

describe('settings response carries the server mode', () => {
  let ctx: TestApp;

  beforeEach(async () => {
    ctx = await createTestApp();
  });
  const originalMode = CONFIG.communityStats.mode;
  afterEach(() => {
    communityConfig.mode = originalMode;
    ctx.close();
  });

  async function mode(): Promise<string | undefined> {
    const res = await ctx.authed('GET', '/api/v1/settings');
    return (await json<{ data: { communityStatsMode?: string } }>(res)).data.communityStatsMode;
  }

  test('GET and PUT report local by default and off when switched off', async () => {
    expect(await mode()).toBe(originalMode);
    const put = await ctx.authed('PUT', '/api/v1/settings', { currencyUnit: 'EUR' });
    expect(
      (await json<{ data: { communityStatsMode?: string } }>(put)).data.communityStatsMode
    ).toBe('local');
    communityConfig.mode = 'off';
    expect(await mode()).toBe('off');
  });

  test('a client cannot write the server mode', async () => {
    const res = await ctx.authed('PUT', '/api/v1/settings', { communityStatsMode: 'off' });
    expect(res.status).toBe(200);
    expect(await mode()).toBe(originalMode);
  });

  test('the response carries the server publication threshold, which a client cannot write', async () => {
    const minGroup = async () =>
      (
        await json<{ data: { communityStatsMinGroup?: number } }>(
          await ctx.authed('GET', '/api/v1/settings')
        )
      ).data.communityStatsMinGroup;
    expect(await minGroup()).toBe(CONFIG.communityStats.minGroup);
    await ctx.authed('PUT', '/api/v1/settings', { communityStatsMinGroup: 2 });
    expect(await minGroup()).toBe(CONFIG.communityStats.minGroup);
  });
});
