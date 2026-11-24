import { afterAll, describe, expect, test } from 'bun:test';
import { CONFIG } from '../../../config';
import { startFakeOidcIssuer } from '../../../test-helpers/fake-oidc-issuer';
import {
  type AuthContractSubject,
  describeAuthContract,
} from '../../../test-helpers/provider-contracts/auth';
import { discoverOidc } from '../providers/oidc';
import { AUTH_PROVIDERS } from '../providers/registry';

const oidcConfig = CONFIG.auth.oidc as { -readonly [K in keyof typeof CONFIG.auth.oidc]: string };
const previousOidc = { ...oidcConfig };
const issuer = startFakeOidcIssuer({
  sub: 'oidc-1',
  email: 'someone@example.com',
  email_verified: true,
});
Object.assign(oidcConfig, {
  issuer: issuer.issuer,
  clientId: 'vroom',
  clientSecret: 'oidc-secret',
  redirectUri: 'http://localhost:3001/api/v1/auth/callback/oidc',
  linkRedirectUri: 'http://localhost:3001/api/v1/auth/callback/link/oidc',
});
await discoverOidc();
afterAll(async () => {
  Object.assign(oidcConfig, previousOidc);
  issuer.stop();
  await discoverOidc();
});

const json = (body: unknown) => Response.json(body);

const SUBJECTS: Record<keyof typeof AUTH_PROVIDERS, Omit<AuthContractSubject, 'provider'>> = {
  google: {
    redirects: {
      login: CONFIG.auth.googleLoginRedirectUri,
      link: CONFIG.auth.googleLinkRedirectUri,
    },
    unverifiedResponses: () => [
      json({ sub: 'g-1', email: 'someone@example.com', name: 'Someone', email_verified: false }),
    ],
  },
  oidc: {
    redirects: {
      login: 'http://localhost:3001/api/v1/auth/callback/oidc',
      link: 'http://localhost:3001/api/v1/auth/callback/link/oidc',
    },
    unverifiedResponses: () => [
      json({ sub: 'oidc-1', email: 'someone@example.com', email_verified: false }),
    ],
  },
  github: {
    redirects: { login: CONFIG.auth.githubRedirectUri, link: CONFIG.auth.githubLinkRedirectUri },
    unverifiedResponses: () => [
      json({ id: 1, login: 'someone', name: null, email: null, avatar_url: '' }),
      json([{ email: 'someone@example.com', primary: true, verified: false, visibility: null }]),
    ],
  },
};

for (const [id, descriptor] of Object.entries(AUTH_PROVIDERS)) {
  const subject = SUBJECTS[id as keyof typeof AUTH_PROVIDERS];
  describeAuthContract(id, { provider: descriptor.create(), ...subject });
}

describe('auth contract coverage', () => {
  test('every auth provider runs the auth contract', () => {
    expect(Object.keys(SUBJECTS).sort()).toEqual(Object.keys(AUTH_PROVIDERS).sort());
  });
});
