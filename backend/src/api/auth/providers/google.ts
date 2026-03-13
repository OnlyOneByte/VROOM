import { Google } from 'arctic';
import { CONFIG } from '../../../config';
import type { OAuthProviderConfig } from './types';

const google = new Google(
  CONFIG.auth.googleClientId || '',
  CONFIG.auth.googleClientSecret || '',
  CONFIG.auth.googleRedirectUri
);

const SCOPES = ['openid', 'profile', 'email'];

export const googleAuthProvider: OAuthProviderConfig = {
  id: 'google',
  displayName: 'Google',
  supportsPKCE: true,
  scopes: SCOPES,
  createAuthorizationURL: (state, codeVerifier) => {
    // biome-ignore lint/style/noNonNullAssertion: codeVerifier is guaranteed present for PKCE providers
    const url = google.createAuthorizationURL(state, codeVerifier!, SCOPES);
    url.searchParams.set('prompt', 'select_account');
    return url;
  },
  validateAuthorizationCode: async (code, codeVerifier) => {
    // biome-ignore lint/style/noNonNullAssertion: codeVerifier is guaranteed present for PKCE providers
    const tokens = await google.validateAuthorizationCode(code, codeVerifier!);
    return {
      accessToken: tokens.accessToken(),
      refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : undefined,
    };
  },
  fetchUserInfo: async (accessToken) => {
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error('Failed to fetch Google user info');
    const data = (await res.json()) as {
      sub: string;
      email: string;
      name: string;
      picture?: string;
    };
    return {
      providerAccountId: data.sub,
      email: data.email,
      displayName: data.name,
      avatarUrl: data.picture,
    };
  },
};
