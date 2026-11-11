// Guards the self-host examples (compose, portainer, .env.example, the nginx snippet in deployment.md)
// against drift from the backend: pass-through variables, required variables, callback paths, and body caps.

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

// Keys of config.ts's envSchema.
const SCHEMA_KEY = /^ {2}([A-Z][A-Z0-9_]*):/gm;
const ENV_FILE_KEY = /^([A-Z][A-Z0-9_]*)=/gm;
const COMPOSE_VAR_REF = /\$\{([A-Z][A-Z0-9_]*)/g;
// Matches both compose (`- NAME=value`) and portainer (`NAME: value`) syntax.
const YAML_ENV_KEY = /^\s*-?\s*([A-Z][A-Z0-9_]*)\s*[:=]/gm;
const REQUIRED_FIELD = /field: '([A-Z_]+)'/g;
const PROCESS_ENV_READ = /process\.env\.([A-Z][A-Z0-9_]*)/g;
// Matches callback URLs in docs and examples.
const CALLBACK_URL = /https?:\/\/[^\s`'"<>)|]*\/auth\/callback\/[^\s`'"<>),|]*/g;

function repoFile(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), 'utf8');
}

function matches(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

// Only these variables reach the backend container.
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

// Read from validateProductionConfig, so the list cannot drift.
function requiredInProduction(): string[] {
  const config = repoFile('backend/src/config.ts');
  const validator = config.slice(config.indexOf('export const validateProductionConfig'));
  return matches(validator, REQUIRED_FIELD);
}

// Schema keys plus direct process.env reads.
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
// The example has no nested blocks.
const NGINX_LOCATION = /location\s+([^{]+?)\s*\{([^}]*)\}/g;
const BODY_SIZE_CAP = /client_max_body_size\s+(\d+)m;/;
const GLOBAL_CAP_SOURCE = /GLOBAL_MAX_BODY_SIZE = (\d+) \* 1024 \* 1024/;
const RESTORE_CAP_SOURCE = /maxFileSize: (\d+) \* 1024 \* 1024/;

// Read from source, not imported: importing config.ts here would bind the DB singleton before createTestApp() sets :memory:.
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

// Null when the block sets no cap of its own.
function capMb(block: string): number | null {
  const cap = block.match(BODY_SIZE_CAP)?.[1];
  return cap ? Number(cap) : null;
}

function serverCapMb(): number | null {
  const example = nginxExample();
  return capMb(example.slice(0, example.indexOf('location ')));
}

function locationBlocks(): { header: string; body: string }[] {
  return [...nginxExample().matchAll(NGINX_LOCATION)].map(([, header, body]) => ({ header, body }));
}

// Matched the way nginx matches regex locations.
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
    // Assumes no session secret is read. Revisit the guards below if that changes.
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

    // Unauthenticated GETs that write nothing. The timeout covers the cold module load behind the source scans.
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

  // The proxy rejects oversized bodies before the backend sees them, so the nginx example is part of the restore limit.
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
      // Matches the app's global cap. A server-wide restore-sized cap would widen every JSON route.
      expect(serverCap).toBe(appCapMb);
      expect(serverCap ?? 0).toBeLessThan(capMb(restoreLocation()?.body ?? '') ?? 0);
    });
  });
});
