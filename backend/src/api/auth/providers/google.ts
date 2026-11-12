import { Google } from 'arctic';
import { CONFIG } from '../../../config';
import type { OAuthProviderConfig } from './types';

// Google requires the token exchange to repeat the authorize step's redirect URI.
function createGoogleClient(redirectUri: string): Google {
  return new Google(
    CONFIG.auth.googleClientId || '',
    CONFIG.auth.googleClientSecret || '',
    redirectUri
  );
}

const googleLoginClient = createGoogleClient(CONFIG.auth.googleLoginRedirectUri);

export const googleStorageClient = createGoogleClient(CONFIG.auth.googleStorageRedirectUri);

const LOGIN_SCOPES = ['openid', 'profile', 'email'];

export const STORAGE_SCOPES = [
  ...LOGIN_SCOPES,
  'https://www.googleapis.com/auth/drive.file',
  // Read-only and limited to items this app created; never widen to the camera roll.
  'https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata',
];

export const googleAuthProvider: OAuthProviderConfig = {
  id: 'google',
  displayName: 'Google',
  supportsPKCE: true,
  createAuthorizationURL: (state, codeVerifier) => {
    // biome-ignore lint/style/noNonNullAssertion: codeVerifier is guaranteed present for PKCE providers
    const url = googleLoginClient.createAuthorizationURL(state, codeVerifier!, LOGIN_SCOPES);
    url.searchParams.set('prompt', 'select_account');
    return url;
  },
  validateAuthorizationCode: async (code, codeVerifier) => {
    // biome-ignore lint/style/noNonNullAssertion: codeVerifier is guaranteed present for PKCE providers
    const tokens = await googleLoginClient.validateAuthorizationCode(code, codeVerifier!);
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
