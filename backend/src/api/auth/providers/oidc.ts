import { CodeChallengeMethod, OAuth2Client } from 'arctic';
import { CONFIG } from '../../../config';
import { logger } from '../../../utils/logger';
import {
  IDP_TIMEOUT_MS,
  NoVerifiedEmailError,
  type OAuthFlow,
  type OAuthProviderConfig,
} from './types';

const SCOPES = ['openid', 'profile', 'email'];

interface OidcEndpoints {
  authorization: string;
  token: string;
  userinfo: string;
}

const DISCOVERY_TIMEOUT_MS = 5_000;
const RETRY_AFTER_MS = 30_000;

let endpoints: OidcEndpoints | null = null;
let lastAttemptAt = 0;
let inFlight: Promise<void> | null = null;

export function oidcConfigured(): boolean {
  const { issuer, clientId, clientSecret } = CONFIG.auth.oidc;
  return !!(issuer && clientId && clientSecret);
}

export function oidcDiscovered(): boolean {
  return endpoints !== null;
}

function describeClaim(value: unknown): string {
  if (value === undefined) return 'missing';
  if (typeof value === 'boolean' || typeof value === 'string') return String(value).slice(0, 32);
  return `a ${value === null ? 'null' : typeof value}`;
}

function issuerUrl(): string {
  return CONFIG.auth.oidc.issuer.replace(/\/+$/, '');
}

export function missingOidcSettings(): string[] {
  const { issuer, clientId, clientSecret } = CONFIG.auth.oidc;
  const settings = {
    OIDC_ISSUER: issuer,
    OIDC_CLIENT_ID: clientId,
    OIDC_CLIENT_SECRET: clientSecret,
  };
  const missing = Object.entries(settings).flatMap(([name, value]) => (value ? [] : [name]));
  return missing.length === Object.keys(settings).length ? [] : missing;
}

let warnedPartialConfig = false;

export async function discoverOidc(): Promise<void> {
  endpoints = null;
  lastAttemptAt = Date.now();
  const missing = missingOidcSettings();
  if (missing.length > 0 && !warnedPartialConfig) {
    warnedPartialConfig = true;
    logger.warn(`OIDC sign-in is off: set ${missing.join(' and ')} too, or unset the others`);
  }
  if (!oidcConfigured()) return;
  const issuer = issuerUrl();
  try {
    const res = await fetch(`${issuer}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`discovery returned HTTP ${res.status}`);
    const doc = (await res.json()) as Record<string, unknown>;
    if (typeof doc.issuer !== 'string' || doc.issuer.replace(/\/+$/, '') !== issuer) {
      throw new Error('discovery names a different issuer than OIDC_ISSUER');
    }
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
    logger.error('OIDC discovery failed; it is retried on a later sign-in request', {
      issuer,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function ensureOidcDiscovered(): Promise<void> {
  if (endpoints || !oidcConfigured()) return;
  if (!inFlight && Date.now() - lastAttemptAt < RETRY_AFTER_MS) return;
  inFlight ??= discoverOidc().finally(() => {
    inFlight = null;
  });
  await inFlight;
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
      signal: AbortSignal.timeout(IDP_TIMEOUT_MS),
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
    const verified = data.email_verified === true || data.email_verified === 'true';
    if (!verified || typeof data.email !== 'string') {
      logger.warn('OIDC sign-in refused: the user info has no verified email', {
        provider: CONFIG.auth.oidc.displayName,
        email: typeof data.email === 'string' ? 'present' : 'missing',
        emailVerified: describeClaim(data.email_verified),
      });
      throw new NoVerifiedEmailError(CONFIG.auth.oidc.displayName);
    }
    if (typeof data.sub !== 'string' || data.sub === '') {
      throw new Error('OIDC user info has no subject');
    }
    const name = [data.name, data.preferred_username].find(
      (value): value is string => typeof value === 'string' && value !== ''
    );
    return {
      providerAccountId: `${issuerUrl()}|${data.sub}`,
      email: data.email,
      displayName: name ?? data.email,
      avatarUrl: typeof data.picture === 'string' ? data.picture : undefined,
    };
  },
};
