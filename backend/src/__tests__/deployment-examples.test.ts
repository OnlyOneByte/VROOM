/**
 * Regression GUARD: the documented self-host stacks must pass through exactly what this backend
 * reads, and the callback URLs they document must be routes it serves.
 *
 * A container sees ONLY what its `environment:` block passes through, which makes both directions
 * of drift silent and expensive:
 *  - `PROVIDER_ENCRYPTION_KEY` is required in production — the backend logs it and exits — yet it
 *    was in neither example stack nor the example env file, so the documented quick start died on
 *    first boot and adding the variable to `.env` could not reach the container;
 *  - `SESSION_SECRET` was still passed and still documented after nothing read it, reading as a
 *    live secret to generate, protect and rotate.
 * The same class covers the OAuth callback: the example env file shipped `/auth/callback/google`
 * while auth mounts under `/api/v1/auth` (and the `/api/*` -> `/api/v1/*` compatibility redirect
 * never sees a bare `/auth/...`), so login 404'd after the user had already granted consent.
 *
 * Everything is derived from the real sources — the required list from `validateProductionConfig`,
 * the readable list from the env schema plus every `process.env` read in non-test source, the
 * routes from the live app — so adding a required variable, or dropping one that is no longer
 * read, fails here until the examples follow.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestApp, type TestApp } from '../test-helpers/http-client';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, '..');
const REPO_ROOT = join(HERE, '..', '..', '..');

const COMPOSE = 'docs/examples/docker-compose.yml';
const PORTAINER = 'docs/examples/portainer-stack.yml';
const ENV_EXAMPLE = 'docs/examples/.env.example';
const DEPLOYMENT_GUIDE = 'docs/deployment.md';
const STACKS = [COMPOSE, PORTAINER];

/** A key of config.ts's `envSchema`, e.g. `  DATABASE_URL: z.string()...`. */
const SCHEMA_KEY = /^ {2}([A-Z][A-Z0-9_]*):/gm;
const ENV_FILE_KEY = /^([A-Z][A-Z0-9_]*)=/gm;
const COMPOSE_VAR_REF = /\$\{([A-Z][A-Z0-9_]*)/g;
/** Both YAML styles: `- NAME=value` (compose) and `NAME: value` (portainer). */
const YAML_ENV_KEY = /^\s*-?\s*([A-Z][A-Z0-9_]*)\s*[:=]/gm;
const REQUIRED_FIELD = /field: '([A-Z_]+)'/g;
const PROCESS_ENV_READ = /process\.env\.([A-Z][A-Z0-9_]*)/g;
/** Any absolute URL naming an OAuth callback, in docs or examples. */
const CALLBACK_URL = /https?:\/\/[^\s`'"<>)|]*\/auth\/callback\/[^\s`'"<>),|]*/g;

function repoFile(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), 'utf8');
}

function matches(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

/** The `environment:` block of a stack's `backend` service — the only env the container gets. */
function backendEnvKeys(stack: string): string[] {
  const yaml = repoFile(stack);
  const service = yaml.slice(yaml.search(/^ {2}backend:$/m));
  const body = service
    .slice(service.search(/^ {4}environment:$/m))
    .split('\n')
    .slice(1);
  const end = body.findIndex((line) => /^ {0,4}\S/.test(line));
  return matches((end === -1 ? body : body.slice(0, end)).join('\n'), YAML_ENV_KEY);
}

/** Variables the backend refuses to start without in production, read from the validator itself. */
function requiredInProduction(): string[] {
  const config = repoFile('backend/src/config.ts');
  const validator = config.slice(config.indexOf('export const validateProductionConfig'));
  return matches(validator, REQUIRED_FIELD);
}

/** Every variable the backend actually consumes: the env schema plus direct `process.env` reads. */
function backendReadsEnvVars(): Set<string> {
  const config = repoFile('backend/src/config.ts');
  const read = new Set(matches(config, SCHEMA_KEY));
  const sources = readdirSync(SRC_ROOT, { recursive: true, encoding: 'utf8' })
    .map((file) => file.split(sep).join('/'))
    // Test scaffolding sets variables nothing in production reads, which would mask the drift.
    .filter((file) => file.endsWith('.ts') && !/__tests__|test-helpers/.test(file));
  for (const file of sources) {
    for (const name of matches(readFileSync(join(SRC_ROOT, file), 'utf8'), PROCESS_ENV_READ)) {
      read.add(name);
    }
  }
  return read;
}

const MEGABYTE = 1024 * 1024;
const RESTORE_PATH = '/api/v1/sync/restore/from-backup';
const NGINX_EXAMPLE = /```nginx\n([\s\S]*?)```/;
/** The example has no nested blocks, so a non-greedy body is enough to split it. */
const NGINX_LOCATION = /location\s+([^{]+?)\s*\{([^}]*)\}/g;
const BODY_SIZE_CAP = /client_max_body_size\s+(\d+)m;/;
const GLOBAL_CAP_SOURCE = /GLOBAL_MAX_BODY_SIZE = (\d+) \* 1024 \* 1024/;
const RESTORE_CAP_SOURCE = /maxFileSize: (\d+) \* 1024 \* 1024/;

/**
 * Limits are read from SOURCE, not imported: a static `import` of config.ts here would freeze
 * `CONFIG` — and with it the DB singleton's path — before `createTestApp` can point it at
 * `:memory:`, so the suite would bind whatever `DATABASE_URL` the developer's `.env` names.
 */
function capFromSource(file: string, pattern: RegExp): number {
  const mb = Number(repoFile(file).match(pattern)?.[1] ?? Number.NaN);
  expect(mb, `could not read ${pattern} from ${file} — the scan has drifted`).not.toBeNaN();
  return mb;
}

function nginxExample(): string {
  const example = repoFile(DEPLOYMENT_GUIDE).match(NGINX_EXAMPLE)?.[1];
  expect(example, `no nginx example found in ${DEPLOYMENT_GUIDE}`).toBeTruthy();
  return example ?? '';
}

/** Megabytes a block allows, or null when it sets no cap of its own. */
function capMb(block: string): number | null {
  const cap = block.match(BODY_SIZE_CAP)?.[1];
  return cap ? Number(cap) : null;
}

/** The server-level cap: whatever is set before the first `location` block. */
function serverCapMb(): number | null {
  const example = nginxExample();
  return capMb(example.slice(0, example.indexOf('location ')));
}

function locationBlocks(): { header: string; body: string }[] {
  return [...nginxExample().matchAll(NGINX_LOCATION)].map(([, header, body]) => ({ header, body }));
}

/** The `location` block that handles the restore upload, matched the way nginx would. */
function restoreLocation(): { header: string; body: string } | undefined {
  return locationBlocks().find(({ header }) => {
    const pattern = header.replace(/^~\s*/, '');
    return header.startsWith('~') && new RegExp(pattern).test(RESTORE_PATH);
  });
}

function documentedCallbackPaths(): { source: string; url: string; path: string }[] {
  return [...STACKS, ENV_EXAMPLE, DEPLOYMENT_GUIDE].flatMap((source) =>
    [...repoFile(source).matchAll(CALLBACK_URL)]
      .map((match) => match[0].replace(/[.,]+$/, ''))
      .map((url) => ({ source, url, path: new URL(url).pathname }))
  );
}

describe('documented deployment examples match the backend', () => {
  test('the sources parse (guard is live, not a no-op)', () => {
    expect(requiredInProduction()).toContain('PROVIDER_ENCRYPTION_KEY');
    expect(backendReadsEnvVars().has('DATABASE_URL')).toBe(true);
    // Nothing reads a session secret any more; if that changes, the guards below need revisiting.
    expect(backendReadsEnvVars().has('SESSION_SECRET')).toBe(false);
    for (const stack of STACKS) {
      expect(backendEnvKeys(stack), `no backend environment block found in ${stack}`).toContain(
        'NODE_ENV'
      );
    }
    expect(matches(repoFile(ENV_EXAMPLE), ENV_FILE_KEY).length).toBeGreaterThan(5);
    expect(documentedCallbackPaths().length).toBeGreaterThan(3);
  });

  test('every production-required variable reaches the container in both example stacks', () => {
    const required = requiredInProduction();
    for (const stack of STACKS) {
      const passed = backendEnvKeys(stack);
      expect(
        required.filter((name) => !passed.includes(name)),
        `${stack} does not pass these through, so the backend exits on first boot in production ` +
          'and no value in `.env` can reach it'
      ).toEqual([]);
    }
  });

  test('every production-required variable is documented in the example env file', () => {
    const defined = matches(repoFile(ENV_EXAMPLE), ENV_FILE_KEY);
    expect(
      requiredInProduction().filter((name) => !defined.includes(name)),
      `${ENV_EXAMPLE} is what a self-hoster copies to .env; a required variable missing from it ` +
        'is a startup failure they have to diagnose from the logs'
    ).toEqual([]);
  });

  test('no example stack passes the backend a variable it no longer reads', () => {
    const read = backendReadsEnvVars();
    for (const stack of STACKS) {
      expect(
        backendEnvKeys(stack).filter((name) => !read.has(name)),
        `${stack} passes variables nothing in the backend reads. A dead variable in a deployment ` +
          'example reads as a live requirement — delete it here and from the docs.'
      ).toEqual([]);
    }
  });

  test('the compose file and the example env file describe the same variables', () => {
    const referenced = [...new Set(matches(repoFile(COMPOSE), COMPOSE_VAR_REF))].sort();
    const defined = [...new Set(matches(repoFile(ENV_EXAMPLE), ENV_FILE_KEY))].sort();
    expect(
      defined,
      `${ENV_EXAMPLE} and ${COMPOSE} are copied as a pair: a variable in only one of them is ` +
        'either a setting that never reaches a container or a documented setting nothing uses'
    ).toEqual(referenced);
  });

  describe('documented OAuth callback URLs', () => {
    let ctx: TestApp;

    // Unauthenticated GETs that write nothing, so one app for the whole block. The generous
    // timeout covers the first load of the app's module graph, which follows this file's
    // source-wide scans and so runs with a cold cache on a loaded machine.
    beforeAll(async () => {
      ctx = await createTestApp();
    }, 30_000);

    const statusFor = async (path: string) => (await ctx.app.request(path)).status;

    test('all resolve to a mounted route', async () => {
      const dead: string[] = [];
      for (const { source, url, path } of documentedCallbackPaths()) {
        if ((await statusFor(path)) === 404) dead.push(`${source}: ${url}`);
      }
      expect(
        dead,
        'these documented callback URLs name paths the backend does not serve, so a user who ' +
          `registers one gets a 404 after granting consent: ${dead.join(', ')}`
      ).toEqual([]);
    });

    test('an unmounted callback path DOES 404 (the probe can tell the difference)', async () => {
      expect(await statusFor('/auth/callback/google')).toBe(404);
      expect(await statusFor('/api/v1/auth/callback/google')).not.toBe(404);
    });

    test('the restore path the nginx example widens is a route the backend serves', async () => {
      const res = await ctx.app.request(RESTORE_PATH, { method: 'POST' });
      expect(
        res.status,
        'if the restore route moved, the nginx example below widens a path that no longer exists'
      ).not.toBe(404);
    });
  });

  /**
   * A proxy rejects on Content-Length before the backend ever sees the request, so the documented
   * nginx config is part of the restore limit. While it set one server-wide 10MB cap, an 11MB
   * backup was 413'd at the proxy and the backend's own 50MB allowance for the data-recovery path
   * was unreachable — the limit that had just been raised, defeated by the deployment example.
   */
  describe('the documented nginx example', () => {
    test('allows a full-size restore upload', () => {
      const restore = restoreLocation();
      expect(
        restore,
        `the nginx example has no location block matching ${RESTORE_PATH}, so the server-wide cap ` +
          'applies and a backup over that size is 413d at the proxy'
      ).toBeTruthy();
      const allowed = (capMb(restore?.body ?? '') ?? 0) * MEGABYTE;
      expect(allowed).toBeGreaterThanOrEqual(
        capFromSource('backend/src/config.ts', RESTORE_CAP_SOURCE) * MEGABYTE
      );
    });

    test('does not raise the cap for every other route', () => {
      const appCapMb = capFromSource('backend/src/app.ts', GLOBAL_CAP_SOURCE);
      const serverCap = serverCapMb();
      expect(serverCap, 'the example must still cap bodies: nginx defaults to 1MB').not.toBeNull();
      // Matching the app's own global cap, not the restore allowance: a server-wide 50MB would
      // hand every JSON route a 5x larger DoS surface than the app itself permits.
      expect(serverCap).toBe(appCapMb);
      expect(serverCap ?? 0).toBeLessThan(capMb(restoreLocation()?.body ?? '') ?? 0);
    });
  });
});
