# Development Guide

Setup guide for local development and contributing to VROOM.

## Prerequisites

- [Bun](https://bun.sh/) (backend runtime)
- Node.js 22+ (see `.nvmrc`)
- [Kiro IDE](https://kiro.dev/) (recommended — project includes skills, hooks, and MCP servers)

## Local Setup

```bash
# Use correct Node version
nvm use

# Backend
cd backend
bun install
cp .env.example .env   # configure Google OAuth credentials
bun run db:push         # apply migrations
bun run dev             # http://localhost:3001

# Frontend (separate terminal)
cd frontend
npm install
cp .env.example .env    # set PUBLIC_API_URL=http://localhost:3001
npm run dev             # http://localhost:5173
```

## Validation

After making changes, run fix then validate in each modified subfolder:

```bash
# Backend
cd backend
bun run all:fix && bun run validate

# Frontend
cd frontend
npm run all:fix && npm run validate
```

The `validate` script runs linting, format checking, type checking, and tests in sequence.

## Kiro IDE Setup

VROOM includes a full `.kiro/` configuration with MCP servers, skills, hooks, and steering files. These are automatically loaded when you open the project in Kiro.

### MCP Servers

Configured in `.kiro/settings/mcp.json`. These connect Kiro to external tools:

| Server | Purpose | Auto-approved tools |
|---|---|---|
| `svelte` | Svelte 5 / SvelteKit docs lookup and component autofixer | `get_documentation`, `svelte_autofixer` |
| `shadcn-svelte` | Component registry search, examples, and blocks | `search_components`, `search_examples`, `search_knowledge` |
| `chrome-devtools` | Live browser debugging via Chrome DevTools Protocol (port 9222) | Navigation, snapshots, clicks, console, network |
| `sqlite` | Direct read access to the VROOM SQLite database | `read_query`, `list_tables`, `describe_table` |
| `playwright` | Browser automation for E2E tests (disabled by default) | — |

The Svelte and shadcn-svelte servers use `npx` and auto-install on first use. The SQLite server requires `uvx` (install via `pip install uv` or Homebrew).

To use Chrome DevTools MCP, launch Chrome with remote debugging:
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222
```

### Skills


Located in `.kiro/skills/`. These are guided workflows Kiro can invoke for common tasks:

| Skill | What it does |
|---|---|
| Add API Endpoint | Walks through creating a new backend domain: routes, repository, frontend service, types, and tests |
| Add Database Table | End-to-end guide for schema changes: Drizzle table, migration, migration test, backup/restore updates |
| Add Expense Category | Updates the category enum, all color/label maps, validation, and tests across frontend and backend |
| Debug Component | Interactive debugging via Chrome DevTools MCP: navigates to a route, checks console/network errors, takes snapshots |

To use a skill, describe the task in chat (e.g., "add a new trips API endpoint") and Kiro will activate the matching skill automatically.

### Hooks

Located in `.kiro/hooks/`. These run automatically on specific events:

| Hook | Trigger | What it does |
|---|---|---|
| Validate After Task | After a spec task completes | Runs `all:fix` + `validate` in modified subfolders |
| Load Steering Before Task | Before a spec task starts | Reads relevant steering files for the files about to be modified |
| Semantic Code Review | After any file write | Checks frontend files for hardcoded colors, wrong API layer, stale categories; checks backend files for error handling, middleware, ownership validation |
| Svelte Autofix on Save | After a `.svelte` file is saved | Runs the Svelte MCP autofixer to catch runes issues and deprecated syntax |
| Migration Reminder | After `schema.ts` is edited | Reminds to generate migration, review SQL, create test, update backup/restore |
| Post-Commit Review | Manual trigger | Reviews the last commit diff for code quality issues |

### Steering Files

Located in `.kiro/steering/`. These provide project-specific rules that Kiro follows automatically:

| File | Scope |
|---|---|
| `MainSteering.md` | Tech stack, Svelte 5 runes, UI components, architecture, code hygiene |
| `APIConventions.md` | Backend route/repository patterns, error handling, response format |
| `CodeQualityRules.md` | Frontend-specific quality checks |
| `DatabaseMigrations.md` | Migration generation, testing, and backup/restore workflow |
| `BackupRestore.md` | Google Drive backup and restore conventions |
| `SveltePatterns.md` | Svelte 5 component patterns and anti-patterns |
| `Testing.md` | Test conventions for Vitest and Playwright |
| `PWA.md` | Service worker and offline support conventions |
| `WorkspaceMCPs.md` | Reference for all configured MCP servers and when to use them |

### Specs

Located in `.kiro/specs/`. These are feature specifications with requirements, design, and implementation tasks. Existing specs:

- `ev-charging-support` — EV charging expense tracking
- `financing-expense-unification` — Merging financing into the expense system
- `insurance-management` — Insurance policy CRUD
- `insurance-term-vehicle-coverage` — Multi-vehicle insurance coverage
- `missed-fillup-mpg-skip` — Skip MPG calculation for missed fill-ups
- `payment-planner` — Payment planning and scheduling
- `vehicle-photos` — Vehicle photo management via Google Drive

To create a new spec, ask Kiro to "create a spec for [feature]" and it will scaffold the requirements → design → tasks workflow.
