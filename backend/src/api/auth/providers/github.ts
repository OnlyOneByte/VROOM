import { GitHub } from 'arctic';
import { CONFIG } from '../../../config';
import type { OAuthProviderConfig } from './types';

const github = new GitHub(
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
  scopes: SCOPES,
  createAuthorizationURL: (state) => {
    return github.createAuthorizationURL(state, SCOPES);
  },
  validateAuthorizationCode: async (code) => {
    const tokens = await github.validateAuthorizationCode(code);
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

    // Always fetch from /user/emails to ensure we get a verified email.
    // The /user endpoint can return an unverified email in the email field.
    const emailRes = await fetch('https://api.github.com/user/emails', { headers });
    if (!emailRes.ok) throw new Error('Failed to fetch GitHub user emails');
    const emails = (await emailRes.json()) as GitHubEmail[];
    const primary = emails.find((e) => e.primary && e.verified);
    if (!primary) throw new Error('No verified email found for GitHub account');

    return {
      providerAccountId: String(userData.id),
      email: primary.email,
      displayName: userData.name || userData.login,
      avatarUrl: userData.avatar_url,
    };
  },
};
