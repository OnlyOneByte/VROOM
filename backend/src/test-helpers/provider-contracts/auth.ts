import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
  NoVerifiedEmailError,
  type OAuthFlow,
  type OAuthProviderConfig,
} from '../../api/auth/providers/types';

export interface AuthContractSubject {
  provider: OAuthProviderConfig;
  redirects: Record<OAuthFlow, string>;
  unverifiedResponses: () => Response[];
}

export function describeAuthContract(name: string, subject: AuthContractSubject): void {
  describe(`${name} auth contract`, () => {
    const spies: { mockRestore: () => void }[] = [];
    afterEach(() => {
      for (const spy of spies.splice(0)) spy.mockRestore();
    });

    for (const flow of ['login', 'link'] as const) {
      test(`the ${flow} authorization URL carries state, PKCE when supported, and the ${flow} redirect`, () => {
        const url = subject.provider.createAuthorizationURL(
          'contract-state',
          'contract-verifier-0123456789-0123456789-0123',
          flow
        );
        expect(url.searchParams.get('state')).toBe('contract-state');
        expect(url.searchParams.get('redirect_uri')).toBe(subject.redirects[flow]);
        if (subject.provider.supportsPKCE) {
          expect(url.searchParams.get('code_challenge')).toBeTruthy();
          expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        }
      });
    }

    test('an unverified email is refused', async () => {
      const responses = subject.unverifiedResponses();
      spies.push(
        spyOn(globalThis, 'fetch').mockImplementation((async () => {
          const next = responses.shift();
          if (!next) throw new Error('the provider made more requests than the contract planned');
          return next;
        }) as unknown as typeof fetch)
      );
      await expect(subject.provider.fetchUserInfo('contract-token')).rejects.toBeInstanceOf(
        NoVerifiedEmailError
      );
    });
  });
}
