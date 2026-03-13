# Requirements Document

## Introduction

The VROOM application currently supports only Google OAuth for authentication. This feature abstracts authentication away from a single provider by reusing the existing `user_providers` table with `domain: 'auth'` rows to store OAuth identity links. Users can sign in with any supported OAuth provider (Google, GitHub), link additional providers to their account from profile settings, and unlink providers they no longer need — with a safety guard preventing removal of the last sign-in method.

## Glossary

- **Auth_System**: The backend authentication subsystem comprising auth routes, the OAuth provider registry, and the auth provider repository
- **OAuth_Provider_Registry**: A centralized registry of supported OAuth auth providers and their configuration, separate from the storage provider registry
- **Auth_Provider_Repository**: The data access layer for auth-domain rows (`domain = 'auth'`) in the `user_providers` table
- **Auth_Row**: A row in `user_providers` with `domain = 'auth'`, representing a linked OAuth identity for login
- **Storage_Row**: A row in `user_providers` with `domain = 'storage'`, representing a connected storage provider (Google Drive, S3)
- **Identity_Tuple**: The combination of `(providerType, providerAccountId)` that uniquely identifies an OAuth identity within the auth domain
- **Login_Page**: The frontend page where users choose an OAuth provider to sign in
- **Profile_Settings**: The frontend page where authenticated users manage linked auth providers
- **Linked_Auth_Provider**: A data object representing a user's linked OAuth identity, including provider type, display name, email, and avatar
- **Legacy_User**: A user created before this feature who has a `users` row but no corresponding `user_providers` auth row
- **PKCE**: Proof Key for Code Exchange, an OAuth 2.0 extension for securing authorization code flows (supported by Google, not by GitHub)
- **Auth_API_Service**: The frontend API service (`auth-api.ts`) that wraps auth-related API calls

## Requirements

### Requirement 1: OAuth Provider Registry

**User Story:** As a developer, I want a centralized registry of supported OAuth providers, so that adding a new auth provider is a configuration-only change.

#### Acceptance Criteria

1. THE OAuth_Provider_Registry SHALL expose a uniform interface for each provider including authorization URL creation, authorization code validation, and user info fetching
2. WHEN a provider is looked up by ID, THE OAuth_Provider_Registry SHALL return the provider configuration if registered, or indicate the provider is unknown
3. WHEN `getEnabledProviders()` is called, THE OAuth_Provider_Registry SHALL return only providers whose client ID and client secret are both non-empty
4. THE OAuth_Provider_Registry SHALL track whether each provider supports PKCE via a `supportsPKCE` flag
5. WHEN a provider does not support PKCE, THE OAuth_Provider_Registry SHALL omit the code verifier from authorization URL creation and code validation calls

### Requirement 2: Auth Provider Repository

**User Story:** As a developer, I want a dedicated data access layer for auth-domain rows, so that all auth identity queries are scoped correctly and isolated from storage rows.

#### Acceptance Criteria

1. THE Auth_Provider_Repository SHALL scope all queries to `domain = 'auth'` in the `user_providers` table
2. WHEN `findByProviderIdentity` is called with a provider type and account ID, THE Auth_Provider_Repository SHALL return the matching auth row or null
3. WHEN `findByUserId` is called, THE Auth_Provider_Repository SHALL return all auth rows for that user ordered by `createdAt` ascending
4. WHEN `create` is called, THE Auth_Provider_Repository SHALL insert a new auth row with `credentials` set to empty string and `config` containing email and optional avatar URL
5. WHEN `countByUserId` is called, THE Auth_Provider_Repository SHALL return the count of auth-domain rows only

### Requirement 3: Login and Signup via OAuth

**User Story:** As a user, I want to sign in with any supported OAuth provider, so that I am not locked into a single sign-in method.

#### Acceptance Criteria

1. WHEN a user initiates login with a supported provider, THE Auth_System SHALL generate an OAuth state parameter (with no `flowType` set), generate a PKCE code verifier if the provider supports it, and redirect to the provider's authorization URL
2. WHEN the OAuth callback is received with a valid state and authorization code, THE Auth_System SHALL exchange the code for tokens and fetch the user's profile information from the provider
3. WHEN the login callback processes a state entry, THE Auth_System SHALL reject entries where `flowType` is set (e.g., `'auth-link'` or `'provider'`) to prevent flow confusion — only entries with no `flowType` are valid for login
4. WHEN the fetched OAuth identity matches an existing auth row, THE Auth_System SHALL resolve to the existing user, update the auth row's profile info and the user's email and display name, and create a Lucia session
5. WHEN updating a returning user's email from provider profile info, THE Auth_System SHALL skip the email update if the new email conflicts with another user's UNIQUE email constraint
6. WHEN the fetched OAuth identity does not match any auth row and no user exists with that email, THE Auth_System SHALL create a new user and a new auth row in a single transaction, then create a Lucia session
7. WHEN the fetched OAuth identity does not match any auth row but a user exists with that email and has no auth row (Legacy_User), THE Auth_System SHALL auto-create an auth row linking the OAuth identity to the existing user and create a Lucia session
8. WHEN the fetched OAuth identity does not match any auth row but a user exists with that email and already has at least one auth row, THE Auth_System SHALL redirect with `auth_error=email_exists`
9. IF the OAuth state parameter is missing or expired, THEN THE Auth_System SHALL redirect to the login page with `auth_error=invalid_state`
10. IF the provider is not registered in the OAuth_Provider_Registry, THEN THE Auth_System SHALL redirect with `auth_error=unknown_provider`
11. IF the provider's authorization server is unavailable or token exchange fails, THEN THE Auth_System SHALL redirect with `auth_error=provider_unavailable`
12. IF the user cancels the OAuth consent screen, THEN THE Auth_System SHALL redirect to the login page with `auth_error=cancelled`

### Requirement 4: Email Collision Handling

**User Story:** As a user, I want clear feedback when my email is already associated with another account, so that I understand how to link my providers correctly.

#### Acceptance Criteria

1. WHEN a new user signs up via OAuth and the email already exists in the users table with an existing auth row, THE Auth_System SHALL reject the signup and redirect with `auth_error=email_exists`
2. THE Auth_System SHALL never implicitly merge accounts based on matching email addresses
3. WHEN `auth_error=email_exists` is received, THE Login_Page SHALL display: "An account with this email already exists. Sign in with your existing account and link this provider from settings."

### Requirement 5: Account Linking

**User Story:** As a user, I want to link additional OAuth providers to my account, so that I can sign in with any of them.

#### Acceptance Criteria

1. WHEN an authenticated user initiates linking with a provider, THE Auth_System SHALL generate an OAuth state containing the user's ID and `flowType=auth-link`, and redirect to the provider's authorization URL
2. WHEN the link callback is received, THE Auth_System SHALL validate that the state's `flowType` is `'auth-link'` and that the state's user ID matches the authenticated session's user ID
3. IF the state's user ID does not match the authenticated session's user ID, THEN THE Auth_System SHALL redirect with `link_error=session_mismatch` and log a CSRF warning
4. WHEN the fetched OAuth identity is not linked to any user, THE Auth_System SHALL create a new auth row for the authenticated user and redirect with `success=linked`
5. IF the fetched OAuth identity is already linked to a different user, THEN THE Auth_System SHALL redirect with `link_error=account_conflict` without modifying any data
6. IF the fetched OAuth identity is already linked to the same user, THEN THE Auth_System SHALL redirect with `link_error=already_linked`
7. IF the user cancels the OAuth consent screen during linking, THEN THE Auth_System SHALL redirect to the profile page with `link_error=cancelled`

### Requirement 6: Account Unlinking

**User Story:** As a user, I want to unlink an OAuth provider from my account, so that I can remove sign-in methods I no longer use.

#### Acceptance Criteria

1. WHEN an authenticated user requests to unlink an auth provider, THE Auth_System SHALL verify the row exists, belongs to the user, and has `domain = 'auth'`
2. IF the user has only one auth-domain row, THEN THE Auth_System SHALL reject the unlink with HTTP 400 and error `{ success: false, error: { code: 'LAST_ACCOUNT', message: 'Cannot unlink your last sign-in method' } }`
3. WHEN the user has more than one auth-domain row, THE Auth_System SHALL delete the specified auth row and return HTTP 204 No Content
4. THE Auth_System SHALL perform the count check and delete within a single database transaction to prevent race conditions where concurrent unlinks both pass the count check
5. IF the specified row does not exist, does not belong to the user, or is not an auth-domain row, THEN THE Auth_System SHALL return HTTP 404 with a `not_found` error

### Requirement 7: Identity Uniqueness

**User Story:** As a system operator, I want each OAuth identity to map to exactly one user, so that identity resolution is deterministic.

#### Acceptance Criteria

1. THE Auth_System SHALL enforce a partial unique index on `(provider_type, provider_account_id)` where `domain = 'auth'` in the `user_providers` table
2. WHEN two concurrent signup requests arrive with the same OAuth identity, THE Auth_System SHALL allow one to succeed and the other SHALL catch the constraint violation, re-query for the existing row, and proceed as an existing-user login
3. THE Auth_System SHALL allow a single user to link multiple identities from the same provider type, provided each identity has a distinct `providerAccountId`

### Requirement 8: Domain Isolation

**User Story:** As a developer, I want auth-domain and storage-domain operations to be fully isolated, so that changes to auth providers never corrupt storage provider data.

#### Acceptance Criteria

1. THE Auth_Provider_Repository SHALL include `domain = 'auth'` in every query, preventing reads or writes to storage-domain rows
2. WHEN a DELETE or PUT request targets a `user_providers` row with `domain = 'auth'` through the existing provider CRUD routes (`/api/v1/providers/:id`), THE Auth_System SHALL reject the request with HTTP 400 and a validation error message
3. WHEN auth-domain operations (link, unlink, login resolution) are performed, THE Auth_System SHALL leave all storage-domain rows unchanged

### Requirement 9: Frontend Login Page

**User Story:** As a user, I want the login page to show only the currently available sign-in options, so that I am not presented with non-functional providers.

#### Acceptance Criteria

1. THE Auth_System SHALL expose a public `GET /auth/providers` endpoint (no authentication required) that returns `{ success: true, data: { id: string, displayName: string }[] }`
2. WHEN the Login_Page loads, THE Login_Page SHALL fetch available providers via the Auth_API_Service and render a sign-in button for each
3. THE Login_Page SHALL render sign-in buttons dynamically from the API response, replacing any hardcoded provider buttons
4. THE Login_Page SHALL show a loading state while fetching providers and an error state if the fetch fails
5. IF no providers are enabled, THE Login_Page SHALL display a message indicating sign-in is currently unavailable
6. THE Login_Page SHALL display user-facing error messages for `auth_error` query params: `invalid_state` → "Your sign-in session expired. Please try again.", `email_exists` → "An account with this email already exists. Sign in with your existing account and link this provider from settings.", `provider_unavailable` → "Sign-in provider is temporarily unavailable. Please try again.", `no_email` → "We couldn't retrieve your email from this provider. Please check your provider's privacy settings.", `unknown_provider` → "This sign-in method is not supported.", `cancelled` → "Sign-in was cancelled."
7. THE Login_Page SHALL use provider icon components from `$lib/components/icons/` (e.g., `GoogleLogo.svelte`, `GitHubLogo.svelte`) and render a generic fallback icon for providers not in the icon map

### Requirement 10: Frontend Linked Accounts Management

**User Story:** As a user, I want to see and manage my linked sign-in methods from my profile, so that I have full control over how I access my account.

#### Acceptance Criteria

1. WHEN an authenticated user visits Profile_Settings, THE Profile_Settings SHALL fetch and display all linked auth providers via the Auth_API_Service's `getLinkedAccounts()` method
2. THE `GET /auth/accounts` endpoint SHALL return `{ success: true, data: LinkedAuthProvider[] }` where each entry contains `id`, `providerType`, `displayName`, `email`, `avatarUrl`, and `createdAt` (extracted from the `config` JSON column and serialized)
3. WHEN a linked auth provider is displayed, THE Profile_Settings SHALL show the provider type, display name, and email for each entry
4. WHEN the user has only one linked auth provider, THE Profile_Settings SHALL disable the unlink button for that provider
5. WHEN `link_error=account_conflict` is received, THE Profile_Settings SHALL display "This account is already linked to a different user."
6. WHEN `link_error=already_linked` is received, THE Profile_Settings SHALL display "This account is already linked to your profile."
7. WHEN `link_error=cancelled` is received, THE Profile_Settings SHALL display "Linking was cancelled."
8. WHEN `success=linked` is received, THE Profile_Settings SHALL display "Account linked successfully."
9. THE Profile_Settings SHALL show a loading state while fetching linked accounts

### Requirement 11: Legacy User Migration

**User Story:** As an existing user, I want my account to work seamlessly with the new multi-provider system, so that I do not lose access.

#### Acceptance Criteria

1. WHEN a Legacy_User logs in via OAuth and their email matches an existing user with no auth row, THE Auth_System SHALL auto-create an auth row linking the OAuth identity to the existing user
2. WHEN the legacy migration creates an auth row, THE Auth_System SHALL proceed with session creation as if the user were an existing user

### Requirement 12: Schema and Migration

**User Story:** As a developer, I want the database schema to support multi-provider auth identities, so that the data model is correct and constraints are enforced.

#### Acceptance Criteria

1. THE Auth_System SHALL add a nullable `provider_account_id` column to the `user_providers` table
2. THE Auth_System SHALL create a partial unique index `up_auth_identity_idx` on `(provider_type, provider_account_id)` where `domain = 'auth'`
3. WHEN an auth row is created, THE Auth_System SHALL set `provider_account_id` to a non-empty value
4. WHEN a storage row is created, THE Auth_System SHALL leave `provider_account_id` as NULL

### Requirement 13: GitHub Email Retrieval

**User Story:** As a user signing in with GitHub, I want my email to be retrieved even if it is set to private, so that my account is created with a valid email.

#### Acceptance Criteria

1. WHEN the GitHub user profile returns a null email, THE OAuth_Provider_Registry SHALL fetch the user's emails from the `/user/emails` endpoint and select the primary verified email
2. IF no verified email is available from GitHub, THEN THE Auth_System SHALL redirect with `auth_error=no_email`

### Requirement 14: Rate Limiting

**User Story:** As a system operator, I want auth endpoints to be rate-limited, so that the system is protected from abuse.

#### Acceptance Criteria

1. THE Auth_System SHALL apply a rate limiter to all auth login, callback, and link endpoints limiting to 30 requests per 15-minute window per client
2. WHEN the rate limit is exceeded, THE Auth_System SHALL reject requests with HTTP 429 (Too Many Requests)
3. THE rate limiter SHALL be wired as middleware on the auth route group in `index.ts`, following the same pattern as existing sync/backup rate limiters

### Requirement 15: Session Independence

**User Story:** As a user, I want my active sessions to remain valid when I link or unlink providers, so that managing my sign-in methods does not disrupt my current session.

#### Acceptance Criteria

1. WHEN an auth provider is linked to a user's account, THE Auth_System SHALL not invalidate any existing sessions for that user
2. WHEN an auth provider is unlinked from a user's account, THE Auth_System SHALL not invalidate any existing sessions for that user

### Requirement 16: Security

**User Story:** As a user, I want the auth system to protect against CSRF and flow confusion attacks, so that my account is secure.

#### Acceptance Criteria

1. THE Auth_System SHALL use separate callback routes for login flows (`/auth/callback/:authProvider`) and link flows (`/auth/callback/link/:authProvider`) to prevent flow confusion attacks
2. WHEN a link callback is received, THE Auth_System SHALL validate the `flowType` field in the stored state matches `auth-link`
3. WHEN a login callback is received, THE Auth_System SHALL reject state entries where `flowType` is set, accepting only entries with no `flowType`
4. THE Auth_System SHALL not store persistent OAuth tokens for auth-domain rows; access tokens are used only transiently during the callback to fetch user info
5. THE Auth_System SHALL expire OAuth state entries after 10 minutes and clean them up periodically

### Requirement 17: Frontend Auth Infrastructure

**User Story:** As a developer, I want a frontend auth API service and proper types, so that auth-related API calls follow project conventions.

#### Acceptance Criteria

1. THE frontend SHALL have an Auth_API_Service at `frontend/src/lib/services/auth-api.ts` with methods: `getProviders()`, `getLinkedAccounts()`, `unlinkAccount(id: string)`
2. THE Auth_API_Service SHALL use `apiClient` from `$lib/services/api-client.ts` for all API calls (no raw `fetch()`)
3. THE frontend SHALL define a `LinkedAuthProvider` type in `$lib/types/user.ts` with fields: `id`, `providerType`, `displayName`, `email`, `avatarUrl?`, `createdAt`
4. THE `LinkedAuthProvider` type SHALL be re-exported from the `$lib/types/index.ts` barrel
5. THE auth store (`auth.svelte.ts`) SHALL replace the `loginWithGoogle()` method with a generic `loginWith(providerId: string)` method that redirects to `${getApiBaseUrl()}/api/v1/auth/login/${providerId}`
6. THE Login_Page and Profile_Settings SHALL use the Auth_API_Service for all auth API calls, not raw `apiClient` or `fetch()`
