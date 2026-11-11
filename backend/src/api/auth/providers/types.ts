export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
}

export interface OAuthUserInfo {
  providerAccountId: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
}

export interface OAuthProviderConfig {
  id: string;
  displayName: string;
  supportsPKCE: boolean;
  createAuthorizationURL: (state: string, codeVerifier?: string) => URL;
  validateAuthorizationCode: (code: string, codeVerifier?: string) => Promise<OAuthTokens>;
  fetchUserInfo: (accessToken: string) => Promise<OAuthUserInfo>;
}

/** The provider authenticated the user but has no verified email to bind the account to. */
export class NoVerifiedEmailError extends Error {
  constructor(provider: string) {
    super(`No verified email found for ${provider} account`);
    this.name = 'NoVerifiedEmailError';
  }
}
