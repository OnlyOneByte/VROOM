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
cp .env.example .env    # set PUBLIC_API_URL=http://localhost:3001
npm run dev             # http://localhost:5173
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
tests, and the build. CI runs the same steps individually, minus the format check.

E2E tests are separate and need both dev servers running:

```bash
cd frontend && npm run test:e2e
```

Some unit tests assert on local calendar dates and currently only pass under `TZ=UTC`.

## Conventions

`.kiro/steering/` holds the project's coding rules — tech stack, Svelte 5 runes patterns,
API and repository patterns, migrations, testing, design system, and UI quality. Read the
ones relevant to what you're touching before writing code; they are the authority on style,
and they are more specific than this guide.

`.kiro/skills/` holds step-by-step workflows for repetitive multi-file tasks (adding an API
endpoint, adding a database table, adding an expense category, debugging a component).

`.kiro/specs/` holds specs for in-flight features as requirements → design → tasks. Specs for
shipped work are deleted once the code lands; git history keeps them.

## Editor integration

`.kiro/settings/mcp.json` configures MCP servers for Svelte and shadcn-svelte docs, SQLite
read access, Chrome DevTools, and Playwright. `.kiro/hooks/` adds on-save and post-task
automation (autofix, validation, migration reminders, review passes). Both are picked up
automatically by [Kiro](https://kiro.dev/) and ignored by other editors.

The Chrome DevTools server expects Chrome on the default debugging port:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```
