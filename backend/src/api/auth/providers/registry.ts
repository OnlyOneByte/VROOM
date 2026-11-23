import { z } from 'zod';
import { CONFIG } from '../../../config';
import type { Availability, ProviderDescriptor } from '../../providers/descriptor';
import { githubAuthProvider } from './github';
import { googleAuthProvider } from './google';
import { oidcAuthProvider, oidcConfigured, oidcDiscovered } from './oidc';
import type { OAuthProviderConfig } from './types';

export type { OAuthProviderConfig, OAuthTokens, OAuthUserInfo } from './types';

export interface AuthFeatures {
  pkce: boolean;
  verifiedEmail: boolean;
}

export type AuthProviderDescriptor = ProviderDescriptor<
  'auth',
  void,
  OAuthProviderConfig,
  AuthFeatures
>;

function authDescriptor(
  provider: OAuthProviderConfig,
  description: string,
  configured: () => boolean
): AuthProviderDescriptor {
  return {
    capability: 'auth',
    get label() {
      return provider.displayName;
    },
    description,
    scope: 'server',
    availability: (): Availability => (configured() ? 'available' : 'hidden'),
    config: { schema: z.strictObject({}), fields: [] },
    secrets: [],
    connect: 'oauth',
    features: { pkce: provider.supportsPKCE, verifiedEmail: true },
    create: () => provider,
  };
}

export const AUTH_PROVIDERS = {
  google: authDescriptor(
    googleAuthProvider,
    'Sign in with a Google account',
    () => !!(CONFIG.auth.googleClientId && CONFIG.auth.googleClientSecret)
  ),
  github: authDescriptor(
    githubAuthProvider,
    'Sign in with a GitHub account',
    () => !!(CONFIG.auth.githubClientId && CONFIG.auth.githubClientSecret)
  ),
  oidc: authDescriptor(
    oidcAuthProvider,
    'Sign in with your own OpenID Connect identity provider',
    () => oidcConfigured() && oidcDiscovered()
  ),
} satisfies Record<string, AuthProviderDescriptor>;

function descriptorFor(id: string): AuthProviderDescriptor | undefined {
  const table: Record<string, AuthProviderDescriptor> = AUTH_PROVIDERS;
  return Object.hasOwn(table, id) ? table[id] : undefined;
}

export function getProvider(id: string): OAuthProviderConfig | undefined {
  return descriptorFor(id)?.create();
}

export function getEnabledProvider(id: string): OAuthProviderConfig | undefined {
  const descriptor = descriptorFor(id);
  return descriptor?.availability() === 'available' ? descriptor.create() : undefined;
}

export function getEnabledProviders(): OAuthProviderConfig[] {
  const table: Record<string, AuthProviderDescriptor> = AUTH_PROVIDERS;
  return Object.values(table)
    .filter((descriptor) => descriptor.availability() === 'available')
    .map((descriptor) => descriptor.create());
}
