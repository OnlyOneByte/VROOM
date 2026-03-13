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
  scopes: string[];
  createAuthorizationURL: (state: string, codeVerifier?: string) => URL;
  validateAuthorizationCode: (code: string, codeVerifier?: string) => Promise<OAuthTokens>;
  fetchUserInfo: (accessToken: string) => Promise<OAuthUserInfo>;
}
