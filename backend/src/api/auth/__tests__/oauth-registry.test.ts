/**
 * Unit tests for OAuth Provider Registry
 *
 * Tests getProvider, getEnabledProviders, unknown provider, and PKCE flags.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

// Store original env values to restore after each test
let originalGoogleClientId: string | undefined;
let originalGoogleClientSecret: string | undefined;
let originalGithubClientId: string | undefined;
let originalGithubClientSecret: string | undefined;

beforeEach(() => {
  originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;
  originalGoogleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  originalGithubClientId = process.env.GITHUB_CLIENT_ID;
  originalGithubClientSecret = process.env.GITHUB_CLIENT_SECRET;
});

afterEach(() => {
  // Restore original env values
  if (originalGoogleClientId !== undefined) {
    process.env.GOOGLE_CLIENT_ID = originalGoogleClientId;
  } else {
    delete process.env.GOOGLE_CLIENT_ID;
  }
  if (originalGoogleClientSecret !== undefined) {
    process.env.GOOGLE_CLIENT_SECRET = originalGoogleClientSecret;
  } else {
    delete process.env.GOOGLE_CLIENT_SECRET;
  }
  if (originalGithubClientId !== undefined) {
    process.env.GITHUB_CLIENT_ID = originalGithubClientId;
  } else {
    delete process.env.GITHUB_CLIENT_ID;
  }
  if (originalGithubClientSecret !== undefined) {
    process.env.GITHUB_CLIENT_SECRET = originalGithubClientSecret;
  } else {
    delete process.env.GITHUB_CLIENT_SECRET;
  }
});

// ---------------------------------------------------------------------------
// getProvider
// ---------------------------------------------------------------------------

describe('getProvider', () => {
  test('returns Google provider config for "google"', async () => {
    const { getProvider } = await import('../providers/registry');
    const google = getProvider('google');
    expect(google).toBeDefined();
    expect(google?.id).toBe('google');
    expect(google?.displayName).toBe('Google');
  });

  test('returns GitHub provider config for "github"', async () => {
    const { getProvider } = await import('../providers/registry');
    const github = getProvider('github');
    expect(github).toBeDefined();
    expect(github?.id).toBe('github');
    expect(github?.displayName).toBe('GitHub');
  });

  test('returns undefined for unknown provider', async () => {
    const { getProvider } = await import('../providers/registry');
    const unknown = getProvider('unknown');
    expect(unknown).toBeUndefined();
  });

  test('returns undefined for empty string', async () => {
    const { getProvider } = await import('../providers/registry');
    const empty = getProvider('');
    expect(empty).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PKCE flags
// ---------------------------------------------------------------------------

describe('PKCE flags', () => {
  test('Google supports PKCE', async () => {
    const { getProvider } = await import('../providers/registry');
    const google = getProvider('google');
    expect(google?.supportsPKCE).toBe(true);
  });

  test('GitHub does not support PKCE', async () => {
    const { getProvider } = await import('../providers/registry');
    const github = getProvider('github');
    expect(github?.supportsPKCE).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Provider interface completeness
// ---------------------------------------------------------------------------

describe('Provider interface', () => {
  test('each provider has required methods', async () => {
    const { getProvider } = await import('../providers/registry');
    for (const id of ['google', 'github']) {
      const provider = getProvider(id);
      expect(provider).toBeDefined();
      expect(typeof provider?.createAuthorizationURL).toBe('function');
      expect(typeof provider?.validateAuthorizationCode).toBe('function');
      expect(typeof provider?.fetchUserInfo).toBe('function');
      expect(typeof provider?.id).toBe('string');
      expect(typeof provider?.displayName).toBe('string');
      expect(typeof provider?.supportsPKCE).toBe('boolean');
      expect(Array.isArray(provider?.scopes)).toBe(true);
    }
  });
});
