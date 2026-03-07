Correctness

Logic errors, off-by-one mistakes, race conditions
Missing error handling or swallowed errors
Incorrect async/await usage (missing awaits, unhandled promises)
Null/undefined access without guards
Type Safety

Use of any or loose types where stricter types exist
Missing or incorrect type annotations
Type assertions that hide real problems (as unknown as X)
Svelte 5 / Frontend

Incorrect runes usage ($state, $derived, $effect, $props)
$effect used where $derived would be correct
state_referenced_locally warnings — apply the decision tree (stable prop vs changing prop)
Forbidden patterns: $:, on:, class: on components, $app/stores
Raw fetch() instead of apiClient / domain services
Missing SSR guards for browser-only APIs
Hardcoded colors instead of semantic tokens
Components that should use shadcn-svelte but don't
Backend

SQL injection or unvalidated input
Missing auth checks on routes
Repository functions that don't handle edge cases (empty results, duplicates)
Drizzle schema/migration mismatches
Missing or incorrect HTTP status codes
Architecture & Conventions

Code in the wrong layer (DB logic in routes, UI logic in stores, etc.)
Duplicated logic that already exists in utils/services
Dead code, unused imports, leftover console.log
Constants or types defined inline that belong in shared modules
Performance

N+1 queries or unnecessary DB round trips
Unbounded caches or missing LRU eviction
Expensive computations in render paths without memoization
Duplicate API calls (e.g., $effect + onMount both fetching)
Security

Secrets or credentials in code
Missing input validation/sanitization
Overly permissive CORS or auth middleware gaps
For each issue found, state the file, the problem, why it matters, and a suggested fix. Group findings by severity (critical → minor). If everything looks clean, say so — don't invent issues.

You can paste your diff or reference specific files after this prompt. It's generic enough to work for any full-stack change but specific enough to catch the patterns that matter in your stack. Want me to tweak it for a particular feature area or save it as a steering file?