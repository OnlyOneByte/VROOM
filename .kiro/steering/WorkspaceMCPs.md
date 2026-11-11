---
inclusion: always
---

# Workspace MCP Servers

`.kiro/settings/mcp.json` holds each server's launch command and its enabled/disabled flag; this
doc covers when to reach for a server and what it actually exposes. An entry in an `autoApprove`
list is NOT evidence a tool exists — those lists are hand-maintained and have drifted from the
servers they name. Use the servers proactively; don't wait to be asked. Tool names here are bare;
your host adds its own prefix.

## `svelte` — Svelte 5 / SvelteKit docs + component validation

`@sveltejs/mcp` registers exactly four tools, and their names are KEBAB-case: `list-sections`,
`get-documentation`, `svelte-autofixer`, `playground-link`. A snake_case spelling resolves to
nothing — including the `get_documentation` / `svelte_autofixer` entries still sitting in this
server's `autoApprove` list, which also omits `list-sections` and `playground-link`.

- Unsure about runes syntax before writing or editing a `.svelte` file: `list-sections` first,
  then one `get-documentation` call with every relevant section.
- After writing a component, run `svelte-autofixer` on it — always with
  `desired_svelte_version: 5` (a tool *argument*, which is snake_case). It catches runes misuse
  and deprecated syntax.
- Also reach for it on a Svelte compile error or warning you can't place.
- `playground-link` only when the user asks for a playground, never when writing to files.

## `shadcn-svelte` — component search, generation, and audit

`@binsarjr/shadcn-svelte-mcp` registers exactly six tools, all search-based: `search_components`,
`search_examples`, `search_knowledge`, `generate_component`, `audit_with_rules`,
`explain_concept`. There is no registry browser, block list, or component-demo tool — so the
`list_components`, `get_component`, `get_component_demo`, `list_blocks` and `get_block` entries in
this server's `autoApprove` list are residue from a different shadcn MCP and resolve to nothing.

- Search before building any custom UI component — `search_components` for the right name,
  then `search_examples` for usage. (`DesignSystem.md` covers what this repo's kit already has.)
- `audit_with_rules` for an a11y / design-system pass over code you just wrote.

## `chrome-devtools` — live debugging of the running app

Connects to Chrome at `http://127.0.0.1:9222`, which must be launched with
`--remote-debugging-port=9222`, with the backend on :3001 and the frontend on :5173. The
**Debug Component** skill (`.kiro/skills/debug-component/`) carries the full workflow,
including how to launch Chrome.

- Prefer `take_snapshot` (accessibility tree) over `take_screenshot` for page structure.
- `list_console_messages` after each navigation to catch errors.
- `list_network_requests` / `get_network_request` to debug a failing API call.
- `performance_start_trace` / `performance_stop_trace` for profiling.

## `sqlite` — the dev database at `backend/data/vroom.db`

For real data: debugging a data issue, confirming a migration applied, checking integrity, or
answering a question about the user's own rows. `list_tables` / `describe_table` report the
live schema; `backend/src/db/schema.ts` is the source of truth for it.

- Investigate with `read_query`. Only use `write_query` when the user explicitly asks to modify
  data — `mcp.json` auto-approves it, so nothing prompts you first; the restraint is yours.
- Never `create_table` — schema changes go through the Drizzle schema plus a migration
  (`DatabaseMigrations.md`).
- WAL mode is on, so reads are safe during writes.

## `playwright` — disabled

`disabled: true` in `mcp.json`. The real e2e suite is `frontend/playwright.config.ts` plus
`frontend/e2e/*.spec.ts`, run with `npm run test:e2e`; use `chrome-devtools` to drive a
browser interactively.
