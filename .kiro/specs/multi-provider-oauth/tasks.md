# Implementation Tasks

## Task 1: Schema and Migration

- [x] Add `providerAccountId: text('provider_account_id')` to `userProviders` table in `backend/src/db/schema.ts`
- [x] Delete existing migration files (`backend/drizzle/0000_regular_shiver_man.sql`, `backend/drizzle/meta/0000_snapshot.json`, reset `backend/drizzle/meta/_journal.json`)
- [x] Run `bun run db:generate` to regenerate fresh `0000` migration
- [x] Append partial unique index SQL to generated migration: `CREATE UNIQUE INDEX IF NOT EXISTS up_auth_identity_idx ON user_providers(provider_type, provider_account_id) WHERE domain = 'auth';`
- [x] Delete local `backend/data/vroom.db*` files
- [x] Update `backend/src/db/seed.ts`: import `userProviders`, add auth-domain row for demo user with `domain: 'auth'`, `providerType: 'google'`, `providerAccountId: 'demo-google-sub'`, `credentials: ''`, `config: { email: sampleUser.email }`
- [x] Verify: `bun run validate` passes in backend

**Requirements**: 12.1, 12.2, 12.3, 12.4

## Task 2: Configuration

- [x] Add to `backend/src/config.ts` `envSchema`: `GITHUB_CLIENT_ID` (optional string), `GITHUB_CLIENT_SECRET` (optional string), `GITHUB_REDIRECT_URI` (string, default `http://localhost:3001/api/v1/auth/callback/github`)
- [x] Add to `CONFIG.auth`: `githubClientId`, `githubClientSecret`, `githubRedirectUri`
- [x] Add to `CONFIG.rateLimit`: `auth: { windowMs: 15 * 60 * 1000, limit: 30 }` (use `limit` not `max` to match existing config pattern)
- [x] Update `backend/.env.example` with `GITHUB_CLIENT_ID=`, `GITHUB_CLIENT_SECRET=`, `GITHUB_REDIRECT_URI=http://localhost:3001/api/v1/auth/callback/github`
- [ ] Verify: `bun run validate` passes in backend

**Requirements**: 14.1, 14.3

## Task 3: OAuth Provider Registry and Task 6 Prep

**Note**: This task and Task 6 have a dependency — Task 3 removes the `google` login-flow export from `lucia.ts`, and Task 6 removes the routes that import it. These must be done together. The `google` export removal in this task must happen simultaneously with the route removal in Task 6.

- [x] Create `backend/src/api/auth/providers/registry.ts` with `OAuthProviderConfig` interface, `OAuthTokens`, `OAuthUserInfo` types, provider map, `getProvider(id)`, `getEnabledProviders()` methods
- [x] `getEnabledProviders()` returns only providers where both clientId and clientSecret are non-empty strings
- [x] Create `backend/src/api/auth/providers/google.ts`: Google provider config wrapping Arctic's `Google` class, `supportsPKCE: true`, scopes closed over `['openid', 'profile', 'email']`, unwrap `OAuth2Tokens` accessor methods to plain `OAuthTokens`
- [x] Create `backend/src/api/auth/providers/github.ts`: GitHub provider config wrapping Arctic's `GitHub` class, `supportsPKCE: false`, scopes closed over `['user:email']`, `fetchUserInfo` calls `/user/emails` fallback for null email, throws if no verified email. Use proper types for the emails response (not `any` — Biome rejects it). Pass `CONFIG.auth.githubClientId || ''` to the constructor (matching the Google pattern for optional config).
- [x] Do NOT remove the `google` export from `lucia.ts` yet — that happens in Task 6 alongside route removal
- [ ] Verify: `bun run validate` passes in backend

**Requirements**: 1.1, 1.2, 1.3, 1.4, 1.5, 13.1, 13.2

## Task 4: Auth Provider Repository

- [x] Create `backend/src/api/auth/auth-provider-repository.ts` with `AuthProviderRepository` class
- [x] All queries scoped with `domain = 'auth'` filter
- [x] Implement `findByProviderIdentity(authProvider, providerAccountId)` — query on `(domain, providerType, providerAccountId)`
- [x] Implement `findByUserId(userId)` — return auth rows ordered by `createdAt` asc
- [x] Implement `create(params)` — insert with `credentials: ''`, `config: { email, avatarUrl }`, `domain: 'auth'`
- [x] Implement `delete(id, userId)` — ownership-scoped delete with domain check
- [x] Implement `countByUserId(userId)` — count auth-domain rows only
- [x] Implement `updateProfile(id, profile)` — update `config` JSON and `displayName`
- [x] Export singleton: `export const authProviderRepository = new AuthProviderRepository(getDb());`
- [ ] Verify: `bun run validate` passes in backend

**Requirements**: 2.1, 2.2, 2.3, 2.4, 2.5

## Task 5: Domain Guard on Provider Routes

- [x] In `backend/src/api/providers/routes.ts`, add domain check after ownership check in DELETE handler: `if (existing[0].domain === 'auth') throw new ValidationError('Auth providers cannot be modified through this endpoint');`
- [x] Add same domain check in PUT handler after ownership check
- [x] In the POST handler, reject requests where `body.domain === 'auth'` — add validation before the insert: `if (body.domain === 'auth') throw new ValidationError('Auth providers cannot be created through this endpoint');`
- [ ] Verify: `bun run validate` passes in backend

**Requirements**: 8.1, 8.2, 8.3

## Task 6: Auth Routes — Login, Callback, and Linking

**Note**: This task combines login routes, link routes, and the `lucia.ts` cleanup into one task to avoid broken intermediate states. Link callback routes MUST be registered BEFORE the generic callback route to avoid route collision (`/auth/callback/link/:authProvider` must not be swallowed by `/auth/callback/:authProvider`).

**CRITICAL — Route file ordering**: New auth routes (login, callback, link, accounts, providers) must be added ABOVE the existing provider-connect routes (`/providers/connect/google`, `/callback/provider/google`) in `routes.ts`. The existing property test `provider-oauth-session.property.test.ts` string-slices `routes.ts` source code between markers and asserts that the provider callback section does NOT contain `lucia.createSession`. If new login callback routes (which DO call `lucia.createSession`) are placed after the provider-connect routes, the test's string slice will capture them and fail.

**CRITICAL — Rate limiter key**: Login and callback routes are unauthenticated — there's no `c.get('user')`. The rate limiter `keyGenerator` must use IP-based keying: `c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'anonymous'`.

- [x] Update `oauthStateStore` type in `backend/src/api/auth/routes.ts`: make `codeVerifier` optional, add `'auth-link'` to `flowType` union
- [x] Add runtime assertion in `resolveProviderState`: if `!storedData.codeVerifier` for provider flow, return `{ error: 'invalid_state', returnTo }`
- [x] Remove old `/login/google` and `/callback/google` routes AND remove the `google` login-flow import/export from `lucia.ts` (keep `googleProvider` for storage provider OAuth)
- [x] Add `GET /auth/providers` — public endpoint (no requireAuth), return `getEnabledProviders()` mapped to `{ id, displayName }`. Response: `{ success: true, data: [...] }`
- [x] Add `GET /auth/login/:authProvider` — look up provider from registry (if not found, redirect with `?auth_error=unknown_provider`), generate state (no flowType), generate codeVerifier if `supportsPKCE`, store in state map, redirect to provider auth URL
- [x] Add `GET /auth/link/:authProvider` — requires `requireAuth`, generate state with `userId` and `flowType: 'auth-link'`, generate codeVerifier if `supportsPKCE`, redirect to provider auth URL
- [x] Add `GET /auth/callback/link/:authProvider` — REGISTER BEFORE the generic callback. Validate session manually using `validateProviderSession` (reuse existing helper in same file). Validate `flowType === 'auth-link'`, validate CSRF (state userId matches session userId), exchange code (PKCE-aware), check conflicts, create auth row or redirect with error. Redirect targets: `${CONFIG.frontend.url}/profile?link_error=...` or `${CONFIG.frontend.url}/profile?success=linked`. Handle cancellation (no `code` param) → redirect with `link_error=cancelled`
- [x] Add `GET /auth/callback/:authProvider` — REGISTER AFTER link callback. Validate state (reject if `flowType` is set — only entries with no flowType are valid for login). Handle cancellation (no `code` param, delete state entry) → redirect to `${CONFIG.frontend.url}/auth?auth_error=cancelled`. Wrap token exchange + user info fetch in try/catch → on failure redirect with `?auth_error=provider_unavailable`. Run 3-way resolution: (a) existing auth row → update profile + update `users.email`/`displayName` (wrap email update in try/catch for UNIQUE constraint — skip email update on conflict), (b) email match with no auth row → legacy migration, (c) email match with auth row → redirect to `${CONFIG.frontend.url}/auth?auth_error=email_exists`, (d) no match → new user transaction with race condition catch
- [x] Add `GET /auth/accounts` — requires `requireAuth`, return linked auth providers with `email`/`avatarUrl` extracted from `config` JSON, `createdAt` serialized as ISO string. Response: `{ success: true, data: LinkedAuthProvider[] }`
- [x] Add `DELETE /auth/accounts/:id` — requires `requireAuth`, transaction-safe unlink: verify row exists + belongs to user + domain is auth, count auth rows, reject if last (HTTP 400 with `LAST_ACCOUNT` error), delete if not (HTTP 204)
- [x] Apply auth rate limiter to login, callback, and link routes only (not to `/auth/me`, `/auth/logout`, `/auth/refresh`, `/auth/accounts`, `/auth/providers`). Create rate limiter from `CONFIG.rateLimit.auth` and apply per-route, following the pattern used in sync routes.
- [ ] Verify: `bun run validate` passes in backend

**Requirements**: 3.1–3.12, 4.1, 5.1–5.7, 6.1–6.5, 9.1, 10.2, 11.1, 11.2, 14.1, 14.2, 15.1, 15.2, 16.1–16.3

## Task 7: Frontend Types, Auth Service, and Auth Store

**Note**: The auth store change (`loginWithGoogle()` → `loginWith()`) and the login page update (Task 8) must happen together to avoid compile errors. This task adds the backward-compat wrapper; Task 8 removes it.

- [x] Add `LinkedAuthProvider` interface to `frontend/src/lib/types/user.ts` with fields: `id`, `providerType`, `displayName`, `email`, `avatarUrl?`, `createdAt`
- [x] Re-export `LinkedAuthProvider` from `frontend/src/lib/types/index.ts`
- [x] Create `frontend/src/lib/services/auth-api.ts` with methods: `getProviders(): Promise<{ id: string, displayName: string }[]>`, `getLinkedAccounts(): Promise<LinkedAuthProvider[]>`, `unlinkAccount(id: string): Promise<void>` — all using `apiClient`. Note: `unlinkAccount` returns `Promise<void>` since the backend returns 204 No Content (no JSON body).
- [x] Update `frontend/src/lib/stores/auth.svelte.ts`: add `loginWith(providerId: string)` method, keep `loginWithGoogle()` as a deprecated wrapper calling `loginWith('google')` (removed in Task 8)
- [ ] Verify: `npm run validate` passes in frontend

**Requirements**: 17.1–17.6

## Task 8: Provider Icon Components

- [x] Create `frontend/src/lib/components/icons/GoogleLogo.svelte` — extract existing inline Google SVG from auth page into a reusable component
- [x] Create `frontend/src/lib/components/icons/GitHubLogo.svelte` — GitHub mark SVG as a Svelte component
- [ ] Verify: `npm run validate` passes in frontend

**Requirements**: 9.7

## Task 9: Frontend Login Page

- [x] Update `frontend/src/routes/auth/+page.svelte`: remove hardcoded Google login button, remove `handleGoogleLogin` function and its `isLoading` state, remove the deprecated `loginWithGoogle()` wrapper from `auth.svelte.ts`
- [x] Fetch providers from `authApi.getProviders()` on mount (use the auth API service, not raw fetch)
- [x] Render dynamic buttons with provider icons from `$lib/components/icons/` icon map with generic fallback for unknown providers
- [x] Add loading state while fetching providers, error state if fetch fails, empty state if no providers enabled
- [x] Read `auth_error` query param from URL, display corresponding user-facing message per Req 9.6
- [x] Use `authStore.loginWith(providerId)` for sign-in action
- [ ] Verify: `npm run validate` passes in frontend

**Requirements**: 9.2–9.7, 4.3

## Task 10: Frontend Profile Linked Accounts

- [x] Replace the existing "Connected Accounts" placeholder card in `frontend/src/routes/profile/+page.svelte` (remove "Coming Soon" badge and `opacity-50` styling) with functional linked accounts implementation
- [x] Fetch accounts from `authApi.getLinkedAccounts()` on mount, display provider type, display name, and email for each
- [x] Disable unlink button when only one account linked
- [x] Wire unlink button to `authApi.unlinkAccount(id)`, remove from list on success
- [x] Add "Link provider" buttons for providers not yet linked (fetch from `authApi.getProviders()`, filter out already-linked provider types). Link action redirects to `${getApiBaseUrl()}/api/v1/auth/link/${providerId}`
- [x] Read `link_error` and `success` query params, display corresponding messages per Req 10.5–10.8
- [x] Add loading state while fetching linked accounts
- [ ] Verify: `npm run validate` passes in frontend

**Requirements**: 10.1–10.9

## Task 11: Tests

- [x] Update `backend/src/db/__tests__/migration-0000.test.ts`: verify `provider_account_id` column exists on `user_providers` table, verify `up_auth_identity_idx` partial unique index is created and enforces uniqueness for auth rows (insert two auth rows with same providerType+providerAccountId, expect constraint error)
- [x] Create `backend/src/api/auth/__tests__/auth-provider-repository.property.test.ts`: use in-memory SQLite with migration helpers (matching existing test pattern), test findByProviderIdentity, findByUserId, create, delete, countByUserId, domain isolation (auth ops don't affect storage rows). Instantiate the repository class with the test DB directly (not the singleton).
- [x] Create `backend/src/api/auth/__tests__/oauth-registry.test.ts`: test getProvider, getEnabledProviders (mock `CONFIG.auth` values via `process.env` overrides in `beforeEach`), unknown provider, PKCE flag
- [x] Create `backend/src/api/auth/__tests__/auth-routes.property.test.ts`: use source-code property tests matching the existing `provider-oauth-session.property.test.ts` pattern — read `routes.ts` source and verify: login callback rejects state entries with flowType set, link callback validates flowType=auth-link, callback/link routes are registered before generic callback routes, public /providers endpoint has no requireAuth, rate limiter is applied to login/callback/link routes
- [x] Add domain guard test to `backend/src/api/providers/__tests__/`: verify DELETE/PUT/POST reject auth-domain rows with ValidationError
- [ ] Verify: `bun run validate` passes in backend, `npm run validate` passes in frontend

**Requirements**: 7.1–7.3, 8.2, all error scenarios
