import { beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLOBAL_MAX_BODY_SIZE } from '../app';
import { CONFIG } from '../config';
import { dialectFromUrl } from '../db/dialect/active';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../test-helpers/http-client';
import { parseTrustedProxies } from '../utils/client-ip';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, '..');
const REPO_ROOT = join(HERE, '..', '..', '..');

const COMPOSE = 'docs/examples/docker-compose.yml';
const PORTAINER = 'docs/examples/portainer-stack.yml';
const ENV_EXAMPLE = 'docs/examples/.env.example';
const DEPLOYMENT_GUIDE = 'docs/deployment.md';
const STACKS = [COMPOSE, PORTAINER];

const SCHEMA_KEY = /^ {2}([A-Z][A-Z0-9_]*):/gm;
const ENV_FILE_KEY = /^([A-Z][A-Z0-9_]*)=/gm;
const COMPOSE_VAR_REF = /\$\{([A-Z][A-Z0-9_]*)/g;
const YAML_ENV_KEY = /^\s*-?\s*([A-Z][A-Z0-9_]*)\s*[:=]/gm;
const REQUIRED_FIELD = /field: '([A-Z_]+)'/g;
const PROCESS_ENV_READ = /process\.env\.([A-Z][A-Z0-9_]*)/g;
const CALLBACK_URL = /https?:\/\/[^\s`'"<>)|]*\/auth\/callback\/[^\s`'"<>),|]*/g;

function repoFile(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), 'utf8');
}

function matches(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

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

function requiredInProduction(): string[] {
  const config = repoFile('backend/src/config.ts');
  const validator = config.slice(config.indexOf('export const validateProductionConfig'));
  return matches(validator, REQUIRED_FIELD);
}

function backendReadsEnvVars(): Set<string> {
  const config = repoFile('backend/src/config.ts');
  const read = new Set(matches(config, SCHEMA_KEY));
  const sources = readdirSync(SRC_ROOT, { recursive: true, encoding: 'utf8' })
    .map((file) => file.split(sep).join('/'))
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
const NGINX_LOCATION = /location\s+([^{]+?)\s*\{([^}]*)\}/g;
const BODY_SIZE_CAP = /client_max_body_size\s+(\d+)m;/;
function nginxExample(): string {
  const example = repoFile(DEPLOYMENT_GUIDE).match(NGINX_EXAMPLE)?.[1];
  expect(example, `no nginx example found in ${DEPLOYMENT_GUIDE}`).toBeTruthy();
  return example ?? '';
}

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

    beforeAll(async () => {
      ctx = await createTestApp();
    }, SETUP_TIMEOUT_MS);

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

  describe('the documented nginx example', () => {
    test('allows a full-size restore upload', () => {
      const restore = restoreLocation();
      expect(
        restore,
        `the nginx example has no location block matching ${RESTORE_PATH}, so the server-wide cap ` +
          'applies and a backup over that size is 413d at the proxy'
      ).toBeTruthy();
      const allowed = (capMb(restore?.body ?? '') ?? 0) * MEGABYTE;
      expect(allowed).toBeGreaterThanOrEqual(CONFIG.backup.maxFileSize);
    });

    test('does not raise the cap for every other route', () => {
      const appCapMb = GLOBAL_MAX_BODY_SIZE / MEGABYTE;
      const serverCap = serverCapMb();
      expect(serverCap, 'the example must still cap bodies: nginx defaults to 1MB').not.toBeNull();
      expect(serverCap).toBe(appCapMb);
      expect(serverCap ?? 0).toBeLessThan(capMb(restoreLocation()?.body ?? '') ?? 0);
    });
  });
});

describe('the trusted proxy recipes in docs/deployment.md', () => {
  const guide = () => repoFile(DEPLOYMENT_GUIDE);
  const recipeTable = () => {
    const text = guide();
    const start = text.indexOf('| Setup | `TRUSTED_PROXY_IPS` |');
    return text.slice(start, text.indexOf('\n\n', start)).split('\n').slice(2);
  };
  const trustedValues = () =>
    recipeTable().flatMap((row) =>
      [...(row.split('|')[2] ?? '').matchAll(/`([0-9a-f.:/]+)`/g)].map((match) => match[1] ?? '')
    );

  test('every documented value is a single address, never a range', () => {
    const values = trustedValues();
    expect(values.length).toBeGreaterThanOrEqual(3);
    for (const value of values) {
      expect(() => parseTrustedProxies([value])).not.toThrow();
      expect(value).not.toContain('/');
    }
  });

  test('the pinned network snippet matches the addresses the table trusts', () => {
    const values = trustedValues();
    const tunnel = /ipv4_address: ([0-9.]+)/.exec(guide())?.[1] ?? 'missing ipv4_address';
    const gateway = /gateway: ([0-9.]+)/.exec(guide())?.[1] ?? 'missing gateway';
    expect(values).toContain(tunnel);
    expect(values).toContain(gateway);
  });
});

describe('the Postgres example', () => {
  const OVERRIDE = 'docs/examples/docker-compose.postgres.yml';

  test('Postgres publishes no port and the password comes fail-fast from .env', () => {
    const yaml = repoFile(OVERRIDE);
    expect(yaml).not.toMatch(/^\s*ports:/m);
    expect(yaml).toContain('POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?');
    expect(yaml).not.toMatch(/POSTGRES_PASSWORD=[^$\s]/);
    expect(yaml).toMatch(/image: postgres:\d+\.\d+-alpine/);
  });

  test('the backend gets a postgres:// URL for the stack service, which it opens as Postgres', () => {
    const url = repoFile(OVERRIDE).match(/DATABASE_URL=(.+)$/m)?.[1] ?? '';
    expect(url).toStartWith('postgres://vroom:${POSTGRES_PASSWORD:?');
    expect(url).toEndWith('@postgres:5432/vroom');
    expect(dialectFromUrl(url)).toBe('pg');
    expect(backendEnvKeys(OVERRIDE)).toEqual(['DATABASE_URL']);
  });

  test('the CI move job keeps its Postgres service on the runner loopback', () => {
    const job = repoFile('.github/workflows/ci-cd.yml').split('postgres-move-smoke:')[1] ?? '';
    expect(job).toContain('- 127.0.0.1:5432:5432');
    expect(job).not.toMatch(/- "?5432:5432/);
  });
});

describe('the Litestream example', () => {
  const OVERRIDE = 'docs/examples/docker-compose.litestream.yml';
  const LITESTREAM = 'docs/examples/litestream.yml';

  test('it turns the backend checkpoints off with a value the backend reads', () => {
    expect(backendEnvKeys(OVERRIDE)).toEqual(['WAL_CHECKPOINTS']);
    expect(repoFile(OVERRIDE)).toContain('- WAL_CHECKPOINTS=off');
    expect(backendReadsEnvVars().has('WAL_CHECKPOINTS')).toBe(true);
  });

  test('it publishes no port, takes secrets fail-fast from .env, and pins the image', () => {
    const yaml = repoFile(OVERRIDE);
    expect(yaml).not.toMatch(/^ {4}ports:/m);
    for (const name of [
      'LITESTREAM_ACCESS_KEY_ID',
      'LITESTREAM_SECRET_ACCESS_KEY',
      'LITESTREAM_BUCKET',
      'LITESTREAM_ENDPOINT',
    ]) {
      expect(yaml).toContain(`${name}=\${${name}:?`);
    }
    expect(yaml).toMatch(/image: litestream\/litestream:\d+\.\d+\.\d+/);
  });

  test('it replicates the database file the backend writes', () => {
    expect(repoFile(LITESTREAM)).toContain('- path: /data/vroom.db');
    expect(repoFile(OVERRIDE)).toContain('- vroom-data:/data');
    expect(repoFile(COMPOSE)).toContain('DATABASE_URL=/app/data/vroom.db');
  });

  test("it runs as the backend image's user, so the shared volume stays writable by the backend", () => {
    expect(repoFile('backend/Dockerfile')).toMatch(/^USER bun$/m);
    expect(repoFile(OVERRIDE)).toMatch(/^ {4}user: "1000:1000"$/m);
  });

  test('the restore drill runs both containers as the host user and gives the drill backend no .env', () => {
    const drill = repoFile('docs/deployment.md').split('### Restore drill')[1].split('```')[1];
    const runs = drill.split('docker run').slice(1);
    expect(runs).toHaveLength(2);
    for (const run of runs) expect(run).toContain('--user "$(id -u):$(id -g)"');
    expect(runs[1]).not.toContain('--env-file');
    expect(runs[1]).toContain('-p 127.0.0.1:');
  });
});

describe('the Portainer stack', () => {
  test("the auto-updater's Docker-controlling dashboard is published on loopback only", () => {
    const yaml = repoFile(PORTAINER);
    const service = yaml.slice(yaml.search(/^ {2}tugtainer:$/m));
    const lines = service
      .slice(service.search(/^ {4}ports:$/m))
      .split('\n')
      .slice(1);
    const end = lines.findIndex((line) => /^ {0,4}\S/.test(line));
    const published = lines.slice(0, end).filter((line) => /^ {6}- /.test(line));
    expect(published.length).toBeGreaterThan(0);
    for (const line of published) expect(line).toMatch(/^ {6}- "127\.0\.0\.1:/);
    expect(service).toContain('/var/run/docker.sock');
  });
});
