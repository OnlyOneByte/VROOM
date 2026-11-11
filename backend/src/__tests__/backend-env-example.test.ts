// Guards backend/.env.example against drift from the backend: every variable it sets must be read,
// HOST must be an address literal, and every documented OAuth callback must be a mounted route.

import { beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestApp, type TestApp } from '../test-helpers/http-client';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, '..');
const REPO_ROOT = join(HERE, '..', '..', '..');

const BACKEND_ENV_EXAMPLE = 'backend/.env.example';

// Keys of config.ts's envSchema.
const SCHEMA_KEY = /^ {2}([A-Z][A-Z0-9_]*):/gm;
// Active assignments only: commented-out lines do not match.
const ENV_FILE_KEY = /^([A-Z][A-Z0-9_]*)=(.*)$/gm;
const PROCESS_ENV_READ = /process\.env\.([A-Z][A-Z0-9_]*)/g;
// Matches callback URLs whether active or commented out.
const CALLBACK_URL = /https?:\/\/[^\s`'"<>)|]*\/auth\/callback\/[^\s`'"<>),|]*/g;

function exampleEnv(): string {
  return readFileSync(join(REPO_ROOT, BACKEND_ENV_EXAMPLE), 'utf8');
}

function assignments(): { name: string; value: string }[] {
  return [...exampleEnv().matchAll(ENV_FILE_KEY)].map(([, name, value]) => ({
    name,
    // Strip the trailing `# why` annotations the file uses on some lines.
    value: value.replace(/\s+#.*$/, '').trim(),
  }));
}

// Everything the backend consumes: schema keys plus direct process.env reads.
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
    // A name makes the bind family resolver-dependent, so one loopback family refuses clients.
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

    // Unauthenticated GETs that write nothing. The timeout covers the cold module load behind the source scan.
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
