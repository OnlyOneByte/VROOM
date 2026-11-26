import { beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import packageJson from '../../package.json';
import * as connection from '../db/connection';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../test-helpers/http-client';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', 'app.ts');

const VERSION_LITERAL = /version\s*:\s*['"][^'"]+['"]/g;

describe('reported version comes from the package, not a literal', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, SETUP_TIMEOUT_MS);

  test('GET /health reports the package version', async () => {
    const res = await ctx.app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; version: string };
    expect(body.status).toBe('ok');
    expect(body.version).toBe(packageJson.version);
  });

  test('GET /api reports the package version alongside the API version', async () => {
    const res = await ctx.app.request('/api');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: string; apiVersion: string };
    expect(body.version).toBe(packageJson.version);
    expect(body.apiVersion).toBe('v1');
  });

  test('app.ts carries no version literal and reads CONFIG.version', () => {
    const src = readFileSync(APP, 'utf8');
    expect(src.length, `unreadable/empty: ${APP}`).toBeGreaterThan(100);
    const literals = [...src.matchAll(VERSION_LITERAL)].map((m) => m[0]);
    expect(
      literals,
      'app.ts must report CONFIG.version (read from package.json), not a hardcoded version ' +
        'string that no release process updates.'
    ).toEqual([]);
    expect(src).toContain('version: CONFIG.version');
  });
});

describe('GET /health checks the database', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, SETUP_TIMEOUT_MS);

  test('a database that cannot answer makes /health 503, keeping the version', async () => {
    const probe = spyOn(connection, 'checkDatabaseHealth').mockReturnValue(false);
    try {
      const res = await ctx.app.request('/health');
      expect(res.status).toBe(503);
      const body = (await res.json()) as { status: string; version: string };
      expect(body.status).toBe('unavailable');
      expect(body.version).toBe(packageJson.version);
    } finally {
      probe.mockRestore();
    }
    expect((await ctx.app.request('/health')).status).toBe(200);
  });
});
