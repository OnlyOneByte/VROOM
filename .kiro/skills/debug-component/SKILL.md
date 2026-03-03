---
name: Debug Component
description: Interactive debugging workflow using Chrome DevTools MCP. Given a component or route description, verifies servers are running, navigates to the page, inspects for errors, and reports findings.
---

# Debug Component

Use this skill when the user asks to visually check, test, or debug a component or route in the running app. This skill uses the Chrome DevTools MCP to interact with the live application.

## Prerequisites

Before starting, verify:
1. Chrome is running with remote debugging enabled (`--remote-debugging-port=9222`)
2. Backend is running on port 3001
3. Frontend dev server is running on port 5173

### Launching Chrome with Remote Debugging

If Chrome isn't running with debugging enabled, launch it. There are two options:

**Option A: Relaunch Chrome (simplest, requires quitting Chrome first)**

The user must quit Chrome first (Cmd+Q), then launch:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/Library/Application Support/Google/Chrome" \
  --no-first-run --no-default-browser-check --profile-directory=Default
```

Use `controlBashProcess` with action `start` since this is a long-running process.

**Option B: Copy profile and run a second instance (keeps existing Chrome open)**

This copies the user's Chrome profile so their Google login and cookies are available without closing their main browser:

```bash
# 1. Copy the profile
mkdir -p /tmp/chrome-debug-profile
rsync -a --quiet ~/Library/Application\ Support/Google/Chrome/Default/ /tmp/chrome-debug-profile/Default/
cp ~/Library/Application\ Support/Google/Chrome/Local\ State /tmp/chrome-debug-profile/Local\ State

# 2. Launch Chrome with the copied profile (use controlBashProcess start)
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-debug-profile \
  --no-first-run --no-default-browser-check --profile-directory=Default
```

**Verify the connection:**

```bash
curl -s http://127.0.0.1:9222/json/version | head -5
```

Or use `mcp_chrome_devtools_list_pages` — if it returns without error, the connection is live.

## Workflow

### Step 1: Verify Services Are Running

Check that both servers are accessible:

```bash
# Check backend health
curl -s http://localhost:3001/health | head -c 200
```

```bash
# Check frontend is serving
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
```

If either is down, tell the user which service needs to be started:
- Backend: `bun run dev` from `backend/`
- Frontend: `npm run dev` from `frontend/`

Do NOT start these yourself — they are long-running processes.

### Step 2: Identify the Target Route

Map the user's description to a frontend route:

| Description | Route |
|---|---|
| dashboard, home | `/dashboard` |
| vehicles, car list | `/vehicles` |
| vehicle detail, car detail | `/vehicles/[id]` |
| expenses, expense list | `/expenses` |
| add expense, new expense | `/expenses/new` or `/expenses` (with dialog) |
| analytics, charts, stats | `/analytics` |
| settings, preferences | `/settings` |
| profile, account | `/profile` |
| insurance | `/insurance` |
| login, auth | `/auth` |
| trips | `/trips` |

If the user mentions a specific vehicle or expense, you may need to query the SQLite database first to get the ID:
```
mcp_sqlite_read_query: SELECT id, make, model, year FROM vehicles LIMIT 10
```

### Step 3: Navigate and Take Initial Snapshot

1. List open pages to find or create the right tab:
   ```
   mcp_chrome_devtools_list_pages
   ```

2. Navigate to the target route:
   ```
   mcp_chrome_devtools_navigate_page: { url: "http://localhost:5173/<route>" }
   ```

3. Wait for the page to load (wait for a key element):
   ```
   mcp_chrome_devtools_wait_for: { text: ["<expected text on page>"] }
   ```

4. Take an accessibility snapshot (preferred over screenshot):
   ```
   mcp_chrome_devtools_take_snapshot
   ```

### Step 4: Check for Errors

1. Check console for errors:
   ```
   mcp_chrome_devtools_list_console_messages: { types: ["error", "warn"] }
   ```

2. Check network requests for failed API calls:
   ```
   mcp_chrome_devtools_list_network_requests: { resourceTypes: ["fetch", "xhr"] }
   ```

3. If there are failed requests, inspect them:
   ```
   mcp_chrome_devtools_get_network_request: { reqid: <id> }
   ```

### Step 5: Interactive Testing (if requested)

If the user wants to test a specific interaction:

1. Take a snapshot to find element UIDs:
   ```
   mcp_chrome_devtools_take_snapshot
   ```

2. Interact with elements using their UIDs:
   ```
   mcp_chrome_devtools_click: { uid: "<element-uid>" }
   mcp_chrome_devtools_fill: { uid: "<input-uid>", value: "test value" }
   ```

3. After interaction, check for new errors:
   ```
   mcp_chrome_devtools_list_console_messages: { types: ["error"] }
   mcp_chrome_devtools_list_network_requests: { resourceTypes: ["fetch", "xhr"] }
   ```

4. Take a screenshot if visual verification is needed:
   ```
   mcp_chrome_devtools_take_screenshot
   ```

### Step 6: Report Findings

Summarize what was found:
- Page loaded successfully or not
- Console errors/warnings (with details)
- Failed API calls (status codes, error messages)
- Visual issues observed
- Any interaction failures

If errors were found, suggest fixes based on the error type:
- **Console errors**: Check the referenced source file and line
- **Network 401**: Auth session may be expired — check cookies/session
- **Network 404**: Endpoint may not exist — check backend routes
- **Network 500**: Backend error — check backend logs or the error response body
- **Hydration errors**: SSR/client mismatch — check for browser-only API usage at module level
- **Svelte warnings**: Component may use deprecated patterns — run the Svelte autofixer

## Advanced: Performance Profiling

If the user reports performance issues:

1. Start a trace:
   ```
   mcp_chrome_devtools_performance_start_trace: { reload: true, autoStop: true }
   ```

2. Analyze insights:
   ```
   mcp_chrome_devtools_performance_analyze_insight: { insightSetId: "...", insightName: "LCPBreakdown" }
   ```

## Advanced: Dark Mode Testing

To verify dark mode styling:
```
mcp_chrome_devtools_emulate: { colorScheme: "dark" }
mcp_chrome_devtools_take_screenshot
```

Then switch back:
```
mcp_chrome_devtools_emulate: { colorScheme: "light" }
```

## Advanced: Mobile Viewport Testing

To test responsive layout:
```
mcp_chrome_devtools_emulate: {
  viewport: { width: 375, height: 812, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
}
mcp_chrome_devtools_take_screenshot
```

Reset to desktop:
```
mcp_chrome_devtools_emulate: { viewport: null }
```
