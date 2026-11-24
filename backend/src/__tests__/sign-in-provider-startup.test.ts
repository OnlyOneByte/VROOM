import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { CONFIG, validateProductionConfig } from '../config';

const config = CONFIG as unknown as {
  env: string;
  encryption: { providerKey: string | undefined };
  auth: Record<string, unknown> & { oidc: Record<string, string> };
};
const SIGN_IN_KEYS = [
  'googleClientId',
  'googleClientSecret',
  'githubClientId',
  'githubClientSecret',
];
let saved: {
  env: string;
  key: string | undefined;
  auth: Record<string, unknown>;
  oidc: Record<string, string>;
};

beforeEach(() => {
  saved = {
    env: config.env,
    key: config.encryption.providerKey,
    auth: Object.fromEntries(SIGN_IN_KEYS.map((key) => [key, config.auth[key]])),
    oidc: { ...config.auth.oidc },
  };
  config.env = 'production';
  config.encryption.providerKey = 'a'.repeat(64);
  for (const key of SIGN_IN_KEYS) config.auth[key] = '';
  Object.assign(config.auth.oidc, { issuer: '', clientId: '', clientSecret: '' });
});

afterEach(() => {
  config.env = saved.env;
  config.encryption.providerKey = saved.key;
  Object.assign(config.auth, saved.auth);
  Object.assign(config.auth.oidc, saved.oidc);
});

function startupErrors(): string[] {
  const exit = spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('exited');
  }) as typeof process.exit);
  const error = spyOn(console, 'error').mockImplementation(() => {});
  try {
    validateProductionConfig();
    return [];
  } catch {
    return error.mock.calls.map((call) => String(call[0]));
  } finally {
    exit.mockRestore();
    error.mockRestore();
  }
}

describe('production startup needs a sign-in provider', () => {
  test('refuses to start with none configured, and says which variables would fix it', () => {
    expect(startupErrors().join('\n')).toContain('a sign-in provider');
  });

  test.each([
    ['Google', { googleClientId: 'id', googleClientSecret: 'secret' }, {}],
    ['GitHub', { githubClientId: 'id', githubClientSecret: 'secret' }, {}],
    ['OIDC', {}, { issuer: 'https://id.example.com', clientId: 'id', clientSecret: 'secret' }],
  ])('starts with only %s configured', (_name, auth, oidc) => {
    Object.assign(config.auth, auth);
    Object.assign(config.auth.oidc, oidc);
    expect(startupErrors()).toEqual([]);
  });

  test('half of a provider is not enough', () => {
    config.auth.oidc.issuer = 'https://id.example.com';
    config.auth.oidc.clientId = 'id';
    expect(startupErrors().join('\n')).toContain('a sign-in provider');
  });
});
