# Development Guide

## Prerequisites

- [Bun](https://bun.sh/) — backend runtime
- Node.js 22+ — frontend (see `.nvmrc`)

## Setup

```bash
nvm use

# Backend
cd backend
bun install
cp .env.example .env   # configure OAuth credentials
bun run db:init         # apply migrations; add --seed for sample data
bun run dev             # http://localhost:3001

# Frontend (separate terminal)
cd frontend
npm ci
npm run dev             # http://localhost:5173, proxies /api to :3001
```

Seeded login is `demo@example.com`.

Use `db:init` rather than `db:push`. Init applies the committed migrations in
`backend/drizzle/`, matching what the server does on startup; `drizzle-kit push` diffs the
schema onto the database directly and will offer to drop columns.

Install the frontend with `npm ci`, not `npm install`. Re-resolving the lockfile changes
which `@rolldown/binding-*` platform package gets installed, and the WASM fallback parser
fails on TypeScript optional parameters in `.svelte` files.

## Validation

Run in each subfolder you modified, and fix everything it reports:

```bash
cd backend  && bun run all:fix && bun run validate
cd frontend && npm run all:fix && npm run validate
```

`all:fix` auto-fixes lint and formatting. `validate` runs the checks: the backend also builds,
while the frontend runs lint, format check, type check, and tests (`npm run validate:local` adds
the build). CI runs the same checks as separate steps and skips only the frontend format check.
The backend's `bun run check` covers formatting too.

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

