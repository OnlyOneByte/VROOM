import { CONFIG } from '../../../config';
import { githubAuthProvider } from './github';
import { googleAuthProvider } from './google';
import type { OAuthProviderConfig } from './types';

export type { OAuthProviderConfig, OAuthTokens, OAuthUserInfo } from './types';

const providers: Record<string, OAuthProviderConfig> = {
  google: googleAuthProvider,
  github: githubAuthProvider,
};

export function getProvider(id: string): OAuthProviderConfig | undefined {
  return providers[id];
}

/** Check if a provider is both registered and has valid credentials configured. */
export function getEnabledProvider(id: string): OAuthProviderConfig | undefined {
  const provider = providers[id];
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
  for (const key in providers) {
    const p = providers[key];
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
