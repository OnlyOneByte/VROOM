import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';

const HERE = dirname(fileURLToPath(import.meta.url));
// Read defaults from the config source, not CONFIG: a developer's .env would replace them.
const CONFIG_SRC = join(HERE, '..', '..', '..', 'config.ts');

const REDIRECT_URI_DEFAULT = /(\w*REDIRECT_URI):\s*z\s*\.string\(\)\s*\.default\('([^']+)'\)/g;

const PROVIDER_DERIVATION = ['/callback/google', '/callback/provider/google'] as const;

function configSrc(): string {
  return readFileSync(CONFIG_SRC, 'utf8');
}

function redirectUriDefaults(): { name: string; uri: string }[] {
  return [...configSrc().matchAll(REDIRECT_URI_DEFAULT)].map(([, name, uri]) => ({ name, uri }));
}

describe('OAuth redirect-URI defaults resolve to mounted routes', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, SETUP_TIMEOUT_MS);

  async function statusFor(uri: string): Promise<number> {
    const res = await ctx.app.request(new URL(uri).pathname);
    return res.status;
  }

  test('the scan finds the redirect-URI defaults (guard is live, not a no-op)', () => {
    const defaults = redirectUriDefaults();
    expect(
      defaults.map((d) => d.name),
      'Could not find the *_REDIRECT_URI defaults in config.ts — the scan has drifted.'
    ).toContain('GOOGLE_REDIRECT_URI');
    expect(defaults.length).toBeGreaterThanOrEqual(2);
  });

  test('every default redirect URI hits a real route (not 404)', async () => {
    const dead: string[] = [];
    for (const { name, uri } of redirectUriDefaults()) {
      const status = await statusFor(uri);
      if (status === 404) dead.push(`${name}=${uri}`);
    }
    expect(
      dead,
      `these redirect-URI defaults point at paths the backend does not serve: ${dead.join(', ')}. ` +
        'A user following one lands on a 404 after granting consent.'
    ).toEqual([]);
  });

  test('the provider URI derived from the Google default also hits a real route', async () => {
    const googleDefault = redirectUriDefaults().find((d) => d.name === 'GOOGLE_REDIRECT_URI');
    expect(googleDefault).toBeTruthy();
    const derived = (googleDefault?.uri ?? '').replace(...PROVIDER_DERIVATION);
    expect(derived).not.toBe(googleDefault?.uri);
    expect(await statusFor(derived)).not.toBe(404);
  });

  test('the link URIs derived from the login defaults hit the link callback', async () => {
    const { linkRedirectFrom } = await import('../../../config');
    for (const [name, provider] of [
      ['GOOGLE_REDIRECT_URI', 'google'],
      ['GITHUB_REDIRECT_URI', 'github'],
    ] as const) {
      const loginDefault = redirectUriDefaults().find((d) => d.name === name)?.uri ?? '';
      const derived = linkRedirectFrom(loginDefault, provider);
      expect(new URL(derived).pathname).toBe(`/api/v1/auth/callback/link/${provider}`);
      expect(await statusFor(derived)).not.toBe(404);
    }
  });

  test('an unset link URI follows the login URI host, and never equals it', async () => {
    const { linkRedirectFrom } = await import('../../../config');
    expect(linkRedirectFrom('https://cars.example.com/api/v1/auth/callback/github', 'github')).toBe(
      'https://cars.example.com/api/v1/auth/callback/link/github'
    );
    expect(
      linkRedirectFrom('https://cars.example.com/vroom/api/v1/auth/callback/google', 'google')
    ).toBe('https://cars.example.com/vroom/api/v1/auth/callback/link/google');
    expect(
      linkRedirectFrom('https://cars.example.com/vroom/api/v1/auth/callback/google/', 'google')
    ).toBe('https://cars.example.com/vroom/api/v1/auth/callback/link/google');
    expect(
      linkRedirectFrom('https://cars.example.com/api/v1/auth/callback/github?x=1#top', 'github')
    ).toBe('https://cars.example.com/api/v1/auth/callback/link/github');
    const unusual = 'https://cars.example.com/oauth/return';
    expect(linkRedirectFrom(unusual, 'google')).toBe(
      'https://cars.example.com/api/v1/auth/callback/link/google'
    );
    for (const login of [
      'https://cars.example.com/api/v1/auth/callback/google',
      'https://cars.example.com/api/v1/auth/callback/google/',
      unusual,
    ]) {
      expect(linkRedirectFrom(login, 'google')).not.toBe(login);
    }
  });

  test('a blank or malformed login URI derives no link URI instead of failing startup', async () => {
    const { linkRedirectFrom } = await import('../../../config');
    expect(linkRedirectFrom('', 'google')).toBe('');
    expect(linkRedirectFrom('not a url', 'github')).toBe('');
  });

  test('an unmounted callback path DOES 404 (the probe can tell the difference)', async () => {
    expect(await statusFor('http://localhost:3001/auth/callback/google')).toBe(404);
    expect(await statusFor('http://localhost:3001/auth/callback/provider/google')).toBe(404);
  });
});
