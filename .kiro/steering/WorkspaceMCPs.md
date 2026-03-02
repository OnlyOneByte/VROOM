---
inclusion: always
---

# Workspace MCP Servers

Reference for the MCP servers available in this workspace. Use these tools proactively — don't wait for the user to ask.

## Svelte MCP (`svelte`)

Provides Svelte 5 and SvelteKit documentation lookup and component validation.

### When to Use
- Before writing or modifying any `.svelte` file — check docs if unsure about Svelte 5 runes syntax
- After writing a Svelte component — run the autofixer to catch issues
- When encountering Svelte compilation errors or warnings

### Key Tools
- `mcp_svelte_list_sections` — list all available doc sections. Call first to find relevant topics.
- `mcp_svelte_get_documentation` — fetch full docs for a section (e.g., `"$state"`, `"routing"`, `"load functions"`). Can accept an array of sections.
- `mcp_svelte_svelte_autofixer` — validate a Svelte component for issues. Pass the component code and `desired_svelte_version: 5`. Always use this before finalizing a Svelte component.
- `mcp_svelte_playground_link` — generate a Svelte playground link for the user to test code. Only use when the user asks for it, not when writing to files.

### Tips
- Always set `desired_svelte_version` to `5` for the autofixer
- The autofixer catches runes issues, deprecated syntax, and common mistakes
- Use `list_sections` first, then `get_documentation` with all relevant sections at once to minimize round trips

## shadcn-svelte MCP (`shadcn-svelte`)

Provides component registry lookup, demos, and block source code for shadcn-svelte v4.

### When to Use
- Before building any UI component — check if shadcn-svelte already has it
- When you need usage examples for a shadcn component
- When building complex UI layouts — check blocks for pre-built patterns

### Key Tools
- `mcp_shadcn_svelte_search_components` — search for components by name or description
- `mcp_shadcn_svelte_search_examples` — search for code examples and patterns
- `mcp_shadcn_svelte_search_knowledge` — search the knowledge base for concepts and Q&A
- `mcp_shadcn_svelte_generate_component` — generate a component from a description
- `mcp_shadcn_svelte_audit_with_rules` — audit code for accessibility, design system compliance, and best practices
- `mcp_shadcn_svelte_explain_concept` — get detailed explanations of shadcn-svelte concepts

### Tips
- Always check the registry before building custom components (project convention)
- Use `search_components` to find the right component name, then `search_examples` for usage patterns
- Components are installed to `$lib/components/ui/` — don't modify them (upstream-managed)

## Playwright MCP (`playwright`)

Browser automation for testing and debugging.

### When to Use
- When writing or debugging Playwright e2e tests
- When you need to interact with the running app programmatically
- For visual regression testing or screenshot comparisons

### Key Tools
- `mcp_playwright_browser_navigate` — navigate to a URL
- `mcp_playwright_browser_snapshot` — capture accessibility snapshot (preferred over screenshots)
- `mcp_playwright_browser_take_screenshot` — capture visual screenshot
- `mcp_playwright_browser_click` — click elements
- `mcp_playwright_browser_fill_form` — fill form fields
- `mcp_playwright_browser_console_messages` — get console output
- `mcp_playwright_browser_network_requests` — inspect network traffic
- `mcp_playwright_browser_evaluate` — run JavaScript in the page

### Tips
- Prefer `browser_snapshot` over `browser_take_screenshot` for understanding page structure
- Use `browser_console_messages` to check for errors after navigation
- Use `browser_network_requests` to debug API call failures

## Chrome DevTools MCP (`chrome-devtools`)

Direct Chrome DevTools Protocol access for debugging the running app. Connects to Chrome at `http://127.0.0.1:9222`.

### When to Use
- For interactive debugging of the running app (see the "Debug Component" skill for the full workflow)
- When you need to inspect network requests, console errors, or page state
- For performance profiling and memory analysis

### Key Tools
- `mcp_chrome_devtools_navigate_page` — navigate to a URL
- `mcp_chrome_devtools_take_snapshot` — get page accessibility tree (preferred)
- `mcp_chrome_devtools_take_screenshot` — capture visual screenshot
- `mcp_chrome_devtools_list_console_messages` — check for errors
- `mcp_chrome_devtools_list_network_requests` / `get_network_request` — inspect API calls
- `mcp_chrome_devtools_evaluate_script` — run JS in the page context
- `mcp_chrome_devtools_click` / `fill` / `fill_form` — interact with elements
- `mcp_chrome_devtools_performance_start_trace` / `performance_stop_trace` — performance profiling

### Prerequisites
- Chrome must be running with `--remote-debugging-port=9222`
- Frontend dev server must be running on port 5173
- Backend must be running on port 3001

## SQLite MCP (`sqlite`)

Direct access to the VROOM SQLite database at `backend/data/vroom.db`.

### When to Use
- When debugging data issues — inspect actual database contents
- When verifying migrations applied correctly
- When checking data integrity or relationships
- When the user asks about their data

### Key Tools
- `mcp_sqlite_list_tables` — list all tables in the database
- `mcp_sqlite_describe_table` — get schema for a specific table
- `mcp_sqlite_read_query` — execute SELECT queries (read-only)
- `mcp_sqlite_write_query` — execute INSERT/UPDATE/DELETE (use with caution)
- `mcp_sqlite_create_table` — create tables (prefer Drizzle migrations instead)

### Rules
- Prefer `read_query` for investigation. Only use `write_query` when the user explicitly asks to modify data.
- Never use `create_table` — always use Drizzle schema + migrations for schema changes.
- The database uses WAL mode. Reads are safe during writes.
- Table names: `users`, `vehicles`, `expenses`, `vehicle_financing`, `insurance_policies`, `insurance_policy_vehicles`, `user_settings`, `sessions`, `photos`
