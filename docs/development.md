# Development Guide

## Prerequisites

- [Bun](https://bun.sh/) — backend runtime
- Node.js — frontend. Use the version in `.nvmrc` (`nvm use` reads it); `npm ci` fails with
  `EBADENGINE` on Node older than 22.22.2

## Setup

```bash
nvm use

# Backend
cd backend
bun install
cp .env.example .env   # configure OAuth credentials
openssl rand -hex 32    # paste the output as PROVIDER_ENCRYPTION_KEY in .env
bun run db:init         # apply migrations; add --seed for sample data
bun run dev             # http://localhost:3001

# Frontend (separate terminal)
cd frontend
npm ci
npm run dev             # http://localhost:5173, proxies /api to :3001
```

Use `db:init` rather than `db:push`. Init applies the committed migrations in
`backend/drizzle/`, matching what the server does on startup; `drizzle-kit push` diffs the
schema onto the database directly and will offer to drop columns.

Install the frontend with `npm ci`, not `npm install`. Re-resolving the lockfile changes
which `@rolldown/binding-*` platform package gets installed, and the WASM fallback parser
fails on TypeScript optional parameters in `.svelte` files.

### Signing in

There is no demo login. Sign-in is OAuth only, so set up at least one provider in
`backend/.env` before you open the app:

- **GitHub:** create an OAuth app at https://github.com/settings/developers with the callback
  URL `http://localhost:3001/api/v1/auth/callback/github`, then fill in `GITHUB_CLIENT_ID` and
  `GITHUB_CLIENT_SECRET`.
- **Google:** create an OAuth client in the Google Cloud Console with the redirect URI
  `http://localhost:3001/api/v1/auth/callback/google`, then fill in `GOOGLE_CLIENT_ID` and
  `GOOGLE_CLIENT_SECRET`. Production requires Google. To use Google Drive storage too, add
  `http://localhost:3001/api/v1/auth/callback/provider/google` as a second redirect URI.

A provider shows on the sign-in page once both its client ID and secret are set, so blank the
Google placeholder values if you use GitHub only. The first sign-in creates your account.

`--seed` (or `bun run db:seed`) adds a sample user, `demo@example.com`, with vehicles and
expenses. Its Google ID is made up, so nobody can sign in as it. To look at its data, open
`backend/data/vroom.db` in any SQLite client.

## Validation

Run in each subfolder you modified, and fix everything it reports:

```bash
cd backend  && bun run all:fix && bun run validate
cd frontend && npm run all:fix && npm run validate
```

`all:fix` auto-fixes lint and formatting. `validate` runs the checks: the backend also builds,
while the frontend runs lint, format check, type check, and tests. The frontend's
`npm run validate:local` runs the build instead of the format check. CI runs the same checks as
separate steps and skips only the frontend format check. The backend's `bun run check` covers
formatting too.

On a Linux arm64 host where Biome's default binary won't start, the backend's `all:fix`,
`check` and `validate` fail too. Use `bun run check:musl:fix` and `bun run validate:local`
instead, which run the musl build of Biome.

The frontend type check runs through `frontend/scripts/type-check.mjs`, a guarded wrapper around
svelte-check. Exit code 2 means the guard failed, so the result cannot be trusted. It does not
mean a type error. The wrapper cannot prove the following:

- It reads svelte-check's output as text. A release that keeps the completion summary but stops
  reporting errors through it would pass. The script's pattern fixtures only prove that the
  regexes match the current format.
- It detects the compiler by patching `child_process.spawn`. If svelte-check starts the compiler
  another way, the guard reports that nothing was checked, and the script needs updating.
- The minimum file count (50, or `VROOM_TYPE_CHECK_MIN_FILES`) applies only to machine output,
  which CI and non-TTY runs use. An interactive run skips it.
- It checks only the app program. The e2e harness is checked separately with
  `npx tsc -p tsconfig.e2e.json --noEmit`.
- Compiler output is captured up to 1 MiB. A failing compiler whose diagnostics fall past that
  limit is reported as a failure, not as a clean pass.

E2E tests are separate, and need neither a backend nor a database. Playwright starts the
frontend dev server itself and mocks every `/api/v1` call in the browser. One-time setup is
`npx playwright install` for the browser binaries. See `frontend/e2e/README.md`.

```bash
cd frontend && npm run test:e2e
```

## Conventions

`docs/conventions/` holds the project's coding rules — one file per area: tech stack, code
quality, Svelte 5 runes patterns, API and repository patterns, migrations, testing (including
external APIs), the design system, UI quality, PWA behavior, and backup/restore. Read the ones
relevant to what you're touching before writing code; they are the authority on style, and they
are more specific than this guide.

