import { GitHub } from 'arctic';
import { CONFIG } from '../../../config';
import { NoVerifiedEmailError, type OAuthProviderConfig } from './types';

const githubLoginClient = new GitHub(
  CONFIG.auth.githubClientId || '',
  CONFIG.auth.githubClientSecret || '',
  CONFIG.auth.githubRedirectUri
);

const SCOPES = ['user:email'];

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: string | null;
}

export const githubAuthProvider: OAuthProviderConfig = {
  id: 'github',
  displayName: 'GitHub',
  supportsPKCE: false,
  createAuthorizationURL: (state) => {
    return githubLoginClient.createAuthorizationURL(state, SCOPES);
  },
  validateAuthorizationCode: async (code) => {
    const tokens = await githubLoginClient.validateAuthorizationCode(code);
    return {
      accessToken: tokens.accessToken(),
    };
  },
  fetchUserInfo: async (accessToken) => {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
    };

    const userRes = await fetch('https://api.github.com/user', { headers });
    if (!userRes.ok) throw new Error('Failed to fetch GitHub user info');
    const userData = (await userRes.json()) as GitHubUser;

    // /user can return an unverified email, so the verified primary comes from /user/emails.
    const emailRes = await fetch('https://api.github.com/user/emails', { headers });
    if (!emailRes.ok) throw new Error('Failed to fetch GitHub user emails');
    const emails = (await emailRes.json()) as GitHubEmail[];
    const primary = emails.find((e) => e.primary && e.verified);
    if (!primary) throw new NoVerifiedEmailError('GitHub');

    return {
      providerAccountId: String(userData.id),
      email: primary.email,
      displayName: userData.name || userData.login,
      avatarUrl: userData.avatar_url,
    };
  },
};
