import { CodeChallengeMethod, OAuth2Client } from 'arctic';
import { CONFIG } from '../../../config';
import { logger } from '../../../utils/logger';
import { NoVerifiedEmailError, type OAuthFlow, type OAuthProviderConfig } from './types';

const SCOPES = ['openid', 'profile', 'email'];

interface OidcEndpoints {
  authorization: string;
  token: string;
  userinfo: string;
}

let endpoints: OidcEndpoints | null = null;

export function oidcConfigured(): boolean {
  const { issuer, clientId, clientSecret } = CONFIG.auth.oidc;
  return !!(issuer && clientId && clientSecret);
}

export function oidcDiscovered(): boolean {
  return endpoints !== null;
}

export async function discoverOidc(): Promise<void> {
  endpoints = null;
  if (!oidcConfigured()) return;
  const issuer = CONFIG.auth.oidc.issuer.replace(/\/+$/, '');
  try {
    const res = await fetch(`${issuer}/.well-known/openid-configuration`);
    if (!res.ok) throw new Error(`discovery returned HTTP ${res.status}`);
    const doc = (await res.json()) as Record<string, unknown>;
    const { authorization_endpoint, token_endpoint, userinfo_endpoint } = doc;
    if (
      typeof authorization_endpoint !== 'string' ||
      typeof token_endpoint !== 'string' ||
      typeof userinfo_endpoint !== 'string'
    ) {
      throw new Error('discovery is missing the authorization, token or userinfo endpoint');
    }
    endpoints = {
      authorization: authorization_endpoint,
      token: token_endpoint,
      userinfo: userinfo_endpoint,
    };
  } catch (error) {
    logger.error('OIDC discovery failed; OIDC sign-in is off until the next start', {
      issuer,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function discovered(): OidcEndpoints {
  if (!endpoints) throw new Error('OIDC provider has not been discovered');
  return endpoints;
}

function client(flow: OAuthFlow): OAuth2Client {
  const { clientId, clientSecret, redirectUri, linkRedirectUri } = CONFIG.auth.oidc;
  return new OAuth2Client(clientId, clientSecret, flow === 'link' ? linkRedirectUri : redirectUri);
}

export const oidcAuthProvider: OAuthProviderConfig = {
  id: 'oidc',
  get displayName() {
    return CONFIG.auth.oidc.displayName;
  },
  supportsPKCE: true,
  createAuthorizationURL: (state, codeVerifier, flow) =>
    client(flow).createAuthorizationURLWithPKCE(
      discovered().authorization,
      state,
      CodeChallengeMethod.S256,
      // biome-ignore lint/style/noNonNullAssertion: codeVerifier is guaranteed present for PKCE providers
      codeVerifier!,
      SCOPES
    ),
  validateAuthorizationCode: async (code, codeVerifier, flow) => {
    const tokens = await client(flow).validateAuthorizationCode(
      discovered().token,
      code,
      codeVerifier ?? null
    );
    return { accessToken: tokens.accessToken() };
  },
  fetchUserInfo: async (accessToken) => {
    const res = await fetch(discovered().userinfo, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error('Failed to fetch OIDC user info');
    const data = (await res.json()) as {
      sub?: unknown;
      email?: unknown;
      email_verified?: unknown;
      name?: unknown;
      preferred_username?: unknown;
      picture?: unknown;
    };
    if (data.email_verified !== true || typeof data.email !== 'string') {
      throw new NoVerifiedEmailError(CONFIG.auth.oidc.displayName);
    }
    if (typeof data.sub !== 'string' || data.sub === '') {
      throw new Error('OIDC user info has no subject');
    }
    const name = [data.name, data.preferred_username].find(
      (value): value is string => typeof value === 'string' && value !== ''
    );
    return {
      providerAccountId: data.sub,
      email: data.email,
      displayName: name ?? data.email,
      avatarUrl: typeof data.picture === 'string' ? data.picture : undefined,
    };
  },
};
