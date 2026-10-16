---
name: Debug Component
description: Interactive debugging workflow using Chrome DevTools MCP. Given a component or route description, verifies servers are running, navigates to the page, inspects for errors, and reports findings.
---

# Debug Component

Use this skill when the user asks to visually check, test, or debug a component or route in the
running app. It drives the live app through the `chrome-devtools` MCP server configured in
`.kiro/settings/mcp.json`, which attaches to an existing Chrome at `http://127.0.0.1:9222`.

Tools below are named bare (`take_snapshot`, `navigate_page`, …) — the client adds its own prefix.
**Every one takes a `pageId`**; get it from `list_pages` first.

## Prerequisites

1. Chrome running with `--remote-debugging-port=9222`
2. Backend on port 3001
3. Frontend dev server on port 5173

### Launching Chrome with remote debugging

Chrome refuses to open the debugging port when `--user-data-dir` is the default profile directory,
reporting *"remote debugging requires a non-default data directory. Specify this using
--user-data-dir."* So run a second instance against a copy of the profile — that keeps the user's
Google login and cookies and leaves their main browser open:

```bash
# 1. Copy the profile
mkdir -p /tmp/chrome-debug-profile
rsync -a --quiet ~/Library/Application\ Support/Google/Chrome/Default/ /tmp/chrome-debug-profile/Default/
cp ~/Library/Application\ Support/Google/Chrome/Local\ State /tmp/chrome-debug-profile/Local\ State

# 2. Launch it (long-running — run it in the background, don't block on it)
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-debug-profile \
  --no-first-run --no-default-browser-check --profile-directory=Default
```

Verify with `curl -s http://127.0.0.1:9222/json/version`, or just call `list_pages` — if it returns
without error the connection is live.

## Workflow

### Step 1: Verify services

```bash
curl -s http://localhost:3001/health            # {"status":"ok",...}
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
```

If either is down, tell the user which to start — `bun run dev` from `backend/`, `npm run dev` from
`frontend/`. Do NOT start them yourself; they are long-running.

### Step 2: Identify the target route

| Description | Route |
|---|---|
| dashboard, home, vehicle list | `/dashboard` |
| vehicle detail | `/vehicles/[id]` |
| add vehicle | `/vehicles/new` |
| expenses, expense list | `/expenses` |
| add expense | `/expenses/new` |
| edit expense | `/expenses/[id]/edit` |
| analytics, charts, stats | `/analytics` |
| reminders | `/reminders` |
| trips | `/trips` |
| insurance | `/insurance` |
| assistant, chat | `/assistant` |
| settings, preferences | `/settings` |
| profile, account | `/profile` |
| login, auth | `/auth` |
| component gallery (dev only) | `/dev/gallery` |

There is no `/vehicles` index — the vehicle list lives on `/dashboard`. The full route map is
`frontend/src/lib/routes.ts`.

For a specific vehicle or expense id, query the DB through the `sqlite` MCP server's `read_query`
(pointed at `backend/data/vroom.db`):

```sql
SELECT id, make, model, year FROM vehicles LIMIT 10
```

### Step 3: Navigate and snapshot

1. `list_pages` — find or create the right tab
2. `navigate_page: { pageId, url: "http://localhost:5173/<route>" }`
3. `wait_for: { pageId, text: ["<expected text>"] }` — resolves when any listed string appears
4. `take_snapshot: { pageId }` — the a11y tree, with a `uid` per element. Prefer this over a
   screenshot; it is what `click`/`fill` need.

### Step 4: Check for errors

```
list_console_messages: { pageId, types: ["error", "warn"] }
list_network_requests: { pageId, resourceTypes: ["fetch", "xhr"] }
get_network_request: { pageId, reqid: <number> }    # for a failed one
```

### Step 5: Interactive testing (if requested)

`take_snapshot` for fresh uids (always use the latest), then:

```
click: { pageId, uid: "<element-uid>" }
fill:  { pageId, uid: "<input-uid>", value: "test value" }
```

Re-check console and network afterwards. `take_screenshot: { pageId }` if visual confirmation is
needed (`fullPage: true` for the whole page).

### Step 6: Report findings

Page loaded or not, console errors/warnings, failed API calls with status and body, visual issues,
interaction failures. Suggest fixes by error type:

- **Console error** — check the referenced source file and line
- **401** — session expired; check cookies/session
- **404** — endpoint may not exist; check the mount in `backend/src/app.ts`
- **500** — check the backend log or the error response body
- **Hydration mismatch** — look for browser-only API usage at module level
- **Svelte warning** — may be a deprecated pattern; run the Svelte MCP autofixer

## Advanced

**Performance:** `performance_start_trace: { pageId, reload: true, autoStop: true }`, then
`performance_analyze_insight: { pageId, insightSetId, insightName: "LCPBreakdown" }` using an id
from the trace's "Available insight sets" list.

**Dark mode:** `emulate: { pageId, colorScheme: "dark" }`; reset with `colorScheme: "auto"`.

**Mobile viewport:** `viewport` is a *string*, `'<width>x<height>x<dpr>[,mobile][,touch][,landscape]'`:

```
emulate: { pageId, viewport: "375x812x3,mobile,touch" }
```

Omit `viewport` to clear the override. `resize_page: { pageId, width, height }` resizes the real
window instead of emulating.
