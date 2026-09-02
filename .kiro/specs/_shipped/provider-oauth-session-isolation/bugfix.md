# Bugfix + Feature: Provider OAuth Session Isolation

## Introduction

When a user connects a Google Drive storage provider, the OAuth flow reuses the login callback (`/callback/google`), which creates a new Lucia session for whatever Google account was selected. If the user picks a different Google account than the one they're logged in with, their main auth session is silently replaced. This is both a security bug (session hijacking via confused deputy) and an architectural gap — provider OAuth needs its own isolated flow that never touches the main auth session.

## Scope

This is a hybrid bugfix + feature. The bugfix is preventing session replacement. The feature is a new provider-specific OAuth flow with proper credential storage, provider email capture, and a separate callback endpoint.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user initiates the provider OAuth flow via `/reauth/google` and selects a different Google account during OAuth consent THEN the shared `/callback/google` handler creates a new Lucia session for the different Google account and replaces the session cookie, logging the user out of their original account

1.2 WHEN a user initiates the provider OAuth flow via `/reauth/google` and selects a Google account that has no existing user record THEN the system creates a new user record for that Google account and creates a session for it, switching the logged-in identity

1.3 WHEN the `/callback/google` handler processes a return from the reauth flow THEN it cannot distinguish between a login flow and a provider connection flow because both use the same endpoint, so it always overwrites the session cookie

1.4 WHEN a Google Drive provider is created via the frontend THEN the frontend sends `credentials: {}` (empty) to `POST /api/v1/providers`, and the actual refresh token is stored on `users.googleRefreshToken` instead of on the provider record — meaning the provider's `credentials` column contains encrypted empty JSON

1.5 WHEN the provider form shows "Google Account Connected" after OAuth THEN it displays `authStore.user.email` (the logged-in user's email), not the email of the Google account that was actually connected for the provider

### Expected Behavior (Correct)

2.1 WHEN a user initiates the provider OAuth flow THEN the system SHALL use a dedicated initiation endpoint (`/providers/connect/google`) and a dedicated callback endpoint (`/callback/provider/google`) that are completely separate from the login flow — no shared code paths for session creation

2.2 WHEN the provider OAuth callback processes a return THEN it SHALL extract the refresh token and the Google account's email from the OAuth response, store them directly in the `user_providers` record (refresh token in `credentials`, email in `config.accountEmail`), and redirect back to the frontend WITHOUT creating a new Lucia session or modifying the session cookie

2.3 WHEN a user selects any Google account during the provider OAuth flow (same or different from their login account) THEN the system SHALL preserve the user's existing auth session — the session cookie MUST NOT be modified

2.4 WHEN a user selects a Google account that has no existing user record during the provider OAuth flow THEN the system SHALL NOT create a new user record — it SHALL only store the OAuth credentials on the provider record owned by the currently authenticated user

2.5 WHEN the provider OAuth callback completes successfully THEN it SHALL redirect back to the frontend with query parameters indicating success and an opaque nonce (e.g., `?provider_connected=true&nonce=xxx`) — no PII (email addresses) in URLs. The frontend retrieves the provider's email via an authenticated API call using the nonce.

2.6 WHEN the provider form displays "Google Account Connected" THEN it SHALL show the provider's connected Google account email (from `config.accountEmail` in edit mode, or from the pending credentials API in create mode), NOT the logged-in user's email

2.7 WHEN the provider OAuth callback stores the refresh token THEN it SHALL store it in the `user_providers.credentials` column (encrypted JSON with `{ refreshToken: "..." }`), NOT in `users.googleRefreshToken` — the provider's credentials are the provider's, not the user's

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user initiates the login flow via `/login/google` and completes OAuth consent THEN the system SHALL CONTINUE TO create or find the user record and create a new Lucia session via the existing `/callback/google` handler — the login flow is untouched

3.2 WHEN a user has an active session and navigates normally THEN the system SHALL CONTINUE TO maintain their session without interruption

3.3 WHEN a user is on the provider form and completes the provider OAuth flow THEN the system SHALL CONTINUE TO redirect back to the provider form page (via the `returnTo` parameter)

3.4 WHEN Google Sheets sync or restore operations need a refresh token THEN they SHALL read from the Google Drive provider's `user_providers.credentials` (the provider's refresh token), NOT from `users.googleRefreshToken` — all Drive operations use the provider's credentials since the Drive account may differ from the login account

### Breaking Change

4.1 This is a breaking change — existing Google Drive providers will need to be re-connected via the new OAuth flow after this update. There is no data migration.

4.2 WHEN the schema change runs THEN `users.googleRefreshToken` SHALL be dropped — the column is removed directly from the initial schema (`0000` migration) and the Drizzle schema, not via a new migration file

4.3 Existing Google Drive providers with empty credentials will stop working until the user re-connects via the new provider OAuth flow

### Security

5.1 WHEN the provider OAuth flow stores state in `oauthStateStore` THEN the state SHALL include the authenticated user's ID and a flow type marker (`provider`), so the callback can verify the session cookie matches the user who initiated the flow — preventing confused-deputy attacks

5.2 WHEN the provider OAuth callback receives a state parameter THEN it SHALL validate that the current session's user ID matches the user ID stored in the state — if they don't match, the callback SHALL reject the request

### Error Handling

6.1 WHEN the user cancels or denies the Google OAuth consent THEN the system SHALL redirect back to the provider form with an error query parameter (e.g., `?provider_error=cancelled`), and the frontend SHALL show an appropriate message

6.2 WHEN the OAuth token exchange fails THEN the system SHALL redirect back to the provider form with an error query parameter, and the frontend SHALL show an appropriate message

6.3 WHEN the user's session expires between starting the provider OAuth flow and completing it THEN the system SHALL redirect to the login page (since the user is no longer authenticated)

### OAuth Scopes

7.1 The provider OAuth flow SHALL request scopes: `openid`, `profile`, `email`, `https://www.googleapis.com/auth/drive.file` (access to files created by this app — sufficient for folder creation and file management within app-created folders)

7.2 The login OAuth flow (`/login/google`) SHALL request only the minimum scopes needed to construct the user: `openid`, `profile`, `email` — no Drive scopes. The current `drive.file` scope SHALL be removed from the login flow since Drive access is now handled entirely by the provider flow. The login flow SHALL use `prompt=select_account` so returning users see the account picker.

### UX Details

8.1 WHEN editing an existing provider and clicking "Change" to re-authenticate THEN the provider OAuth initiation SHALL accept an optional `email` hint parameter and pass it as `login_hint` to Google's authorization URL, so Google pre-selects the correct account

8.2 WHEN the provider form is in create mode and the user has not yet completed the provider OAuth flow THEN the form SHALL show the "Connect Google Account" button (not a pre-filled connected state)

8.3 WHEN the provider form is in edit mode THEN the form SHALL show the provider's connected email from `config.accountEmail`, with a "Change" button to re-authenticate
