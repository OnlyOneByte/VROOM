/**
 * Regression GUARD: the version `GET /health` and `GET /api` report is the build's real version.
 *
 * The health endpoint is what the container healthcheck, the deployment docs and the bug-report
 * template all point at, and the reported version is what a user pastes into an issue. It was a
 * literal `'1.0.0'` with no link to the package or the build, so it would have stayed `1.0.0`
 * through every release — a confidently wrong answer in every bug report.
 *
 * The HTTP assertions below cannot distinguish a literal from the real value while package.json
 * still says 1.0.0, so the source-scan is the part that bites: app.ts must read `CONFIG.version`
 * (which is sourced from package.json) and must not carry a version literal. Re-hardcode either
 * endpoint and this goes RED; bump package.json and the responses follow.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import packageJson from '../../package.json';
import { createTestApp, type TestApp } from '../test-helpers/http-client';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', 'app.ts');

/** Any `version: '...'` / `version: "..."` literal — what this guard forbids in app.ts. */
const VERSION_LITERAL = /version\s*:\s*['"][^'"]+['"]/g;

describe('reported version comes from the package, not a literal', () => {
  let ctx: TestApp;

  // Read-only probes (unauthenticated GETs that write nothing), so one app for the suite.
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
    // apiVersion is the ROUTE contract (/api/v1/*), unrelated to the build version.
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
