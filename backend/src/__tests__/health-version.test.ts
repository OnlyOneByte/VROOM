import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import packageJson from '../../package.json';
import { createTestApp, type TestApp } from '../test-helpers/http-client';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', 'app.ts');

const VERSION_LITERAL = /version\s*:\s*['"][^'"]+['"]/g;

describe('reported version comes from the package, not a literal', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

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
