import { CONFIG } from '../../../config';
import { githubAuthProvider } from './github';
import { googleAuthProvider } from './google';
import type { OAuthProviderConfig } from './types';

export type { OAuthProviderConfig, OAuthTokens, OAuthUserInfo } from './types';

export const AUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  google: googleAuthProvider,
  github: githubAuthProvider,
};

export function getProvider(id: string): OAuthProviderConfig | undefined {
  return AUTH_PROVIDERS[id];
}

export function getEnabledProvider(id: string): OAuthProviderConfig | undefined {
  const provider = AUTH_PROVIDERS[id];
  if (!provider) return undefined;
  const enabledIds = new Set(getEnabledProviders().map((p) => p.id));
  return enabledIds.has(id) ? provider : undefined;
}

export function getEnabledProviders(): OAuthProviderConfig[] {
  const clientSecrets: Record<string, string | undefined> = {
    google: CONFIG.auth.googleClientSecret,
    github: CONFIG.auth.githubClientSecret,
  };
  const clientIds: Record<string, string | undefined> = {
    google: CONFIG.auth.googleClientId,
    github: CONFIG.auth.githubClientId,
  };

  const result: OAuthProviderConfig[] = [];
  for (const key in AUTH_PROVIDERS) {
    const p = AUTH_PROVIDERS[key];
    const id = clientIds[p.id];
    const secret = clientSecrets[p.id];
    if (
      typeof id === 'string' &&
      id.length > 0 &&
      typeof secret === 'string' &&
      secret.length > 0
    ) {
      result.push(p);
    }
  }
  return result;
}
