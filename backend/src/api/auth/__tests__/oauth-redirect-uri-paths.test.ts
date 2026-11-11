/**
 * Regression GUARD: every OAuth redirect-URI DEFAULT in config.ts must name a path this backend
 * actually serves.
 *
 * A redirect URI is registered with the identity provider and then called by the user's browser,
 * so a wrong path fails at the end of a real login — after consent — with a 404 the operator has
 * to reverse-engineer. The Google login default pointed at `/auth/callback/google` while the auth
 * routes mount under `/api/v1/auth`, and the `/api/*` -> `/api/v1/*` compatibility redirect never
 * sees a bare `/auth/...` path; the storage-provider URI is derived from the same value, so one
 * wrong default broke both flows for anyone trusting it.
 *
 * The defaults are read out of the config SOURCE rather than from `CONFIG`, because a developer's
 * `.env` (which Bun auto-loads) would otherwise silently substitute its own value and the default
 * could rot untested. Each default's pathname is then probed against the real app: a mounted route
 * answers (a redirect/validation error for a callback with no `code`), an unmounted one 404s.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_SRC = join(HERE, '..', '..', '..', 'config.ts');

/** e.g. `GOOGLE_REDIRECT_URI: z.string().default('http://localhost:3001/api/v1/auth/...')`. */
const REDIRECT_URI_DEFAULT = /(\w*REDIRECT_URI):\s*z\s*\.string\(\)\s*\.default\('([^']+)'\)/g;

/**
 * GOOGLE_PROVIDER_REDIRECT_URI has no literal default — it is derived from the login URI by this
 * substitution (config.ts). Kept in sync by the "derivation still applies" test below.
 */
const PROVIDER_DERIVATION = ['/callback/google', '/callback/provider/google'] as const;

function configSrc(): string {
  return readFileSync(CONFIG_SRC, 'utf8');
}

function redirectUriDefaults(): { name: string; uri: string }[] {
  return [...configSrc().matchAll(REDIRECT_URI_DEFAULT)].map(([, name, uri]) => ({ name, uri }));
}

describe('OAuth redirect-URI defaults resolve to mounted routes', () => {
  let ctx: TestApp;

  // Read-only probes (unauthenticated GETs that write nothing), so one app for the suite.
  beforeAll(async () => {
    ctx = await createTestApp();
  });

  /** GET the URI's path on the real app and report the status. */
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
    // The substitution must actually apply, or the derived URI silently equals the login one.
    expect(derived).not.toBe(googleDefault?.uri);
    expect(await statusFor(derived)).not.toBe(404);
  });

  test('an unmounted callback path DOES 404 (the probe can tell the difference)', async () => {
    expect(await statusFor('http://localhost:3001/auth/callback/google')).toBe(404);
    expect(await statusFor('http://localhost:3001/auth/callback/provider/google')).toBe(404);
  });
});
