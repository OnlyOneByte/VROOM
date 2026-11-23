import { describe, expect, test } from 'bun:test';
import { CONFIG } from '../../../config';
import {
  type AuthContractSubject,
  describeAuthContract,
} from '../../../test-helpers/provider-contracts/auth';
import { AUTH_PROVIDERS } from '../providers/registry';

const json = (body: unknown) => Response.json(body);

const SUBJECTS: Record<string, Omit<AuthContractSubject, 'provider'>> = {
  google: {
    redirects: {
      login: CONFIG.auth.googleLoginRedirectUri,
      link: CONFIG.auth.googleLinkRedirectUri,
    },
    unverifiedResponses: () => [
      json({ sub: 'g-1', email: 'someone@example.com', name: 'Someone', email_verified: false }),
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

for (const [id, provider] of Object.entries(AUTH_PROVIDERS)) {
  const subject = SUBJECTS[id];
  if (subject) describeAuthContract(id, { provider, ...subject });
}

describe('auth contract coverage', () => {
  test('every auth provider runs the auth contract', () => {
    expect(Object.keys(SUBJECTS).sort()).toEqual(Object.keys(AUTH_PROVIDERS).sort());
  });
});
