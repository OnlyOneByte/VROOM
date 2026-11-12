# CLAUDE.md — VROOM agent entry point

VROOM is a self-hostable PWA for tracking the true cost of car ownership. Two apps in one
repo:

- `backend/` — Hono on Bun, Drizzle ORM + SQLite (WAL), Lucia auth, Biome. Dev port 3001.
- `frontend/` — SvelteKit + Svelte 5 runes, Tailwind v4, shadcn-svelte, layerchart. Dev port 5173.

Coding conventions live in `docs/conventions/*.md`. Read `MainSteering.md`, `SveltePatterns.md`,
`CodeQualityRules.md`, `DatabaseMigrations.md`, and `Testing.md` before writing code;
`DesignSystem.md` + `UIQuality.md` before writing UI.

## Commands

| | Backend (`cd backend`) | Frontend (`cd frontend`) |
|---|---|---|
| Install | `bun install` | `npm ci` |
| Dev server | `bun run dev` | `npm run dev` |
| Tests | `bun test` | `npm run test` |
| Full gate | `bun run all:fix && bun run validate` | `npm run all:fix && npm run validate` |

`validate` = lint, format, type-check, tests, build. Run it in every subfolder you modified
and fix everything it reports, including pre-existing findings. CI runs the same commands,
regrouped into job steps — the backend pairs `type-check` and `check` into one step, the
frontend keeps type-check, lint, tests, and build separate — and skips only the frontend
format check.

First-time backend setup: copy `.env.example` to `.env`, then `bun run db:init` (add
`--seed`, or `bun run db:seed`, for sample data — seeded login is `demo@example.com`).
Use `db:init`, not `db:push`: init applies the committed `drizzle/` migrations, while
`drizzle-kit push` diffs the schema straight onto the DB and will offer to drop columns.

## Architecture in one pass

Backend request path: `middleware → routes → repository → Drizzle → SQLite`. One folder per
domain under `src/api/<domain>/` (`routes.ts`, plus a `*repository.ts` for whatever data
access it has), mounted at `/api/v1/<domain>` in `src/app.ts`. Every repository takes a
Drizzle handle in its constructor and is exported as a singleton — no DI; many also extend
`BaseRepository` for the common CRUD.

Frontend data path: `route/page → component → store → service → apiClient`. `api-client.ts`
is the only place app code calls the global `fetch`; `api-transformer.ts` owns the expense
shape conversion (`expenseAmount` → `amount`, and `volume` → `volume` or `charge` by fuel
type), so every expense read goes through `fromBackendExpense`.

Expense-linked records (financing payments, insurance premiums, reminder materializations) use
a polymorphic `source_type` + `source_id` pair on `expenses` rather than per-feature columns.

See `docs/architecture.md` for the design decisions behind these.

## Quality bar

A green build is the floor, not "done".

1. **Data safety is sacred.** No silent loss. Every schema table is either round-tripped by
   backup/restore or on the documented exclusion list in the backend's
   `src/api/sync/__tests__/backup-table-coverage.test.ts` (account identity, sessions,
   encrypted provider credentials, per-device push subscriptions), and those guards fail if
   a new table is silently omitted; destructive actions disclose their full cascade; offline
   writes never drop.
2. **Correct for everyone.** Unit- and currency-correct for metric and non-USD users;
   timezone-correct dates; a user can never read or write another user's data.
3. **Four states + a11y + mobile-first.** Every surface handles loading, empty, error, and
   data; passes axe; no mobile horizontal overflow.
4. **Compose, don't reinvent.** One way to do a thing. Use the kit (`/dev/gallery` in dev,
   `DesignSystem.md`) and the shared helpers.
5. **Leave a guard.** When you fix a bug class, commit a test that fails without the fix.
6. **No comments in code.** Names, types, and structure carry the intent. Do not add comments,
   JSDoc, file headers, section labels, or commented-out code: they go stale and mislead the next
   reader, human or agent. When a comment feels necessary, rename or extract a well-named
   function or constant instead. The only exceptions are tool directives (`biome-ignore`,
   `eslint-disable`, `ts-expect-error`, `svelte-ignore`), a one-line reason inside an
   intentionally empty block, and a one-line note for an external constraint the code cannot
   express (a vendor quirk, a SQLite limit, a security invariant). Never write ticket IDs,
   changelog prose, or "fixed in…" notes; history belongs in git.
   `backend/src/__tests__/no-code-comments.test.ts` scans both apps and fails CI on any comment not
   listed in its allowlist; adding an entry needs the same justification as an exception.

## Hard rules

- Never commit or push to `main`, and never force-push a shared branch. Work on a branch;
  a human opens the PR and approves every merge.
- Never read or commit credential files. `.env` stays local.
- Prefer editing an existing file over adding one; delete dead code rather than parking it.
