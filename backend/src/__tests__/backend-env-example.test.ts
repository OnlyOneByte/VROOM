/**
 * Regression GUARD for `backend/.env.example` — the file README.md, docs/development.md and
 * CLAUDE.md all tell a developer to copy to `backend/.env`.
 *
 * Its sibling guard (deployment-examples.test.ts) scans `docs/examples/.env.example`, the file the
 * deployment quick start copies, so three defects survived in THIS one:
 *  - `HOST=localhost` put back the exact value the hardened `127.0.0.1` default removed. A name
 *    binds whichever loopback family the resolver answers first, so on an IPv6-first host the
 *    backend listened on `[::1]:3001` only and both documented reverse-proxy upstreams
 *    (`proxy_pass http://127.0.0.1:3001`) got ECONNREFUSED — a 502 on the whole site, while
 *    `curl http://localhost:3001/health` still passed because curl retries across families.
 *  - `GOOGLE_REDIRECT_URI=.../auth/callback/google` in the production block named a bare
 *    `/auth/...` path the backend does not serve (auth mounts under `/api/v1/auth`, and the
 *    `/api/*` -> `/api/v1/*` compatibility redirect never sees it), so login 404'd AFTER the user
 *    had already granted consent.
 *  - `SESSION_SECRET` was still documented, with `openssl rand -base64 32` instructions, after
 *    nothing read it — a dead variable in an example env reads as a live secret to generate,
 *    protect and rotate.
 *
 * Everything is derived from the real sources — the readable set from config.ts's env schema plus
 * every `process.env` read in non-test source, the routes from the live app — so dropping a reader
 * or moving a callback fails here until this file follows.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestApp, type TestApp } from '../test-helpers/http-client';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, '..');
const REPO_ROOT = join(HERE, '..', '..', '..');

const BACKEND_ENV_EXAMPLE = 'backend/.env.example';

/** A key of config.ts's `envSchema`, e.g. `  DATABASE_URL: z.string()...`. */
const SCHEMA_KEY = /^ {2}([A-Z][A-Z0-9_]*):/gm;
/** An ACTIVE assignment in an env file — a commented-out line does not match. */
const ENV_FILE_KEY = /^([A-Z][A-Z0-9_]*)=(.*)$/gm;
const PROCESS_ENV_READ = /process\.env\.([A-Z][A-Z0-9_]*)/g;
/** Any absolute URL naming an OAuth callback, active or commented. */
const CALLBACK_URL = /https?:\/\/[^\s`'"<>)|]*\/auth\/callback\/[^\s`'"<>),|]*/g;

function exampleEnv(): string {
  return readFileSync(join(REPO_ROOT, BACKEND_ENV_EXAMPLE), 'utf8');
}

/** Active `NAME=value` assignments, in file order. */
function assignments(): { name: string; value: string }[] {
  return [...exampleEnv().matchAll(ENV_FILE_KEY)].map(([, name, value]) => ({
    name,
    // Strip the trailing `# why` annotations the file uses on some lines.
    value: value.replace(/\s+#.*$/, '').trim(),
  }));
}

/** Every variable the backend actually consumes: the env schema plus direct `process.env` reads. */
function backendReadsEnvVars(): Set<string> {
  const config = readFileSync(join(SRC_ROOT, 'config.ts'), 'utf8');
  const read = new Set([...config.matchAll(SCHEMA_KEY)].map((match) => match[1]));
  const sources = readdirSync(SRC_ROOT, { recursive: true, encoding: 'utf8' })
    .map((file) => file.split(sep).join('/'))
    // Test scaffolding sets variables nothing in production reads, which would mask the drift.
    .filter((file) => file.endsWith('.ts') && !/__tests__|test-helpers/.test(file));
  for (const file of sources) {
    const source = readFileSync(join(SRC_ROOT, file), 'utf8');
    for (const match of source.matchAll(PROCESS_ENV_READ)) read.add(match[1]);
  }
  return read;
}

describe('backend/.env.example matches the backend', () => {
  test('the scan is live, not a no-op', () => {
    const names = assignments().map((entry) => entry.name);
    expect(names.length).toBeGreaterThan(5);
    expect(names).toContain('HOST');
    expect(backendReadsEnvVars().has('DATABASE_URL')).toBe(true);
    expect([...exampleEnv().matchAll(CALLBACK_URL)].length).toBeGreaterThan(2);
  });

  test('HOST is a literal address, not a resolvable name', () => {
    const host = assignments().find((entry) => entry.name === 'HOST')?.value;
    // IPv4 dotted quad, or a bracketed/bare IPv6 literal. `localhost` (or any other name) is the
    // defect: the bind family becomes resolver-dependent, so a proxy dialing the other loopback
    // family gets ECONNREFUSED on every request.
    expect(host, 'HOST must be an address literal so the bind family is deterministic').toMatch(
      /^(\d{1,3}(\.\d{1,3}){3}|\[?[0-9a-fA-F:]+\]?)$/
    );
  });

  test('it defines no variable the backend does not read', () => {
    const read = backendReadsEnvVars();
    expect(
      assignments()
        .map((entry) => entry.name)
        .filter((name) => !read.has(name)),
      `${BACKEND_ENV_EXAMPLE} is what a developer copies to .env. A variable nothing reads is ` +
        'indistinguishable from a live setting — and for a secret, it asks them to generate, ' +
        'protect and rotate something with no reader. Delete it here when the reader goes.'
    ).toEqual([]);
  });

  describe('its OAuth callback URLs', () => {
    let ctx: TestApp;

    // Unauthenticated GETs that write nothing, so one app for the whole block. The generous
    // timeout covers the first load of the app's module graph, which follows this file's
    // source-wide scan and so runs with a cold cache on a loaded machine.
    beforeAll(async () => {
      ctx = await createTestApp();
    }, 30_000);

    const statusFor = async (path: string) => (await ctx.app.request(path)).status;

    test('all resolve to a mounted route, including the commented production block', async () => {
      const urls = [...exampleEnv().matchAll(CALLBACK_URL)].map((match) =>
        match[0].replace(/[.,]+$/, '')
      );
      const dead: string[] = [];
      for (const url of urls) {
        if ((await statusFor(new URL(url).pathname)) === 404) dead.push(url);
      }
      expect(
        dead,
        'these callback URLs name paths the backend does not serve, so a user who registers one ' +
          `gets a 404 after granting consent: ${dead.join(', ')}`
      ).toEqual([]);
    });

    test('a bare /auth/... callback DOES 404 (the probe can tell the difference)', async () => {
      expect(await statusFor('/auth/callback/google')).toBe(404);
      expect(await statusFor('/api/v1/auth/callback/google')).not.toBe(404);
    });
  });
});
