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

`all:fix` auto-fixes lint and formatting; `validate` runs lint, format check, type check,
tests, and the build. CI runs the same checks as separate steps; only the frontend format
check is skipped (the backend's `bun run check` covers formatting too).

E2E tests are separate, and need neither a backend nor a database — Playwright starts the
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

