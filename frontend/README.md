# VROOM frontend

SvelteKit PWA (Svelte 5 runes, Tailwind v4, shadcn-svelte). It talks to the Hono backend in
`../backend` through `/api/v1`.

Setup, environment, and the backend side are in the [Development Guide](../docs/development.md).
Run `npm ci`, not `npm install`.

## Commands

| Command                                | What it does                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm run dev`                          | Vite dev server on http://localhost:5173. Proxies `/api` to the backend on :3001     |
| `npm run build`                        | Production build (`adapter-node`), written to `build/`                               |
| `node build`                           | Serves the production build                                                          |
| `npm run preview`                      | Serves the built bundle on :4173 with the same `/api` proxy                          |
| `npm run test`                         | Vitest unit and component tests                                                      |
| `npm run test:e2e`                     | Playwright suite. See [e2e/README.md](e2e/README.md)                                 |
| `npm run type-check`                   | Guarded svelte-check. See the [type-check limits](../docs/development.md#validation) |
| `npm run lint`, `npm run format:check` | ESLint and Prettier, read-only                                                       |
| `npm run all:fix && npm run validate`  | Auto-fix, then the full gate                                                         |
| `npm run generate-pwa-assets`          | Regenerates the icon set from `static/favicon.svg`                                   |

## Layout

- `src/routes/`: file-based routes. Each route folder can hold its own `__tests__/`.
- `src/lib/components/`: `ui/` for shadcn-svelte primitives, `common/` for app-level patterns, and
  one folder per domain.
- `src/lib/services/`: the API layer. `api-client.ts` is the only code that calls `fetch`.
- `src/lib/stores/`, `src/lib/utils/`, `src/lib/constants/`, `src/lib/theme/`: shared state,
  helpers, constants, and the theme registry.
- `e2e/`: Playwright specs, with `mockApi` in `e2e/support/`. No backend is needed.
- `scripts/type-check.mjs`: the guarded svelte-check runner.

The conventions for this code are in [docs/conventions/](../docs/conventions/).
