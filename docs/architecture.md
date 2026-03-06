# Architecture

VROOM is a monorepo with a Bun/Hono backend API and a SvelteKit frontend PWA, connected via REST.

## System Overview

```
Browser (SvelteKit PWA)
    ↓ REST API (JSON)
Hono Backend (Bun runtime)
    ↓ Drizzle ORM
SQLite (WAL mode)
    ↓ Optional sync
Google Drive / Google Sheets
```

## Backend Architecture

### Directory Layout

```
backend/src/
├── api/                    # Domain modules
│   ├── auth/               # Google OAuth + session management
│   │   ├── lucia.ts        # Lucia auth setup
│   │   ├── routes.ts       # Auth route handlers
│   │   └── utils.ts        # Auth utilities
│   ├── vehicles/           # Vehicle CRUD + statistics
│   │   ├── repository.ts   # Data access layer
│   │   └── routes.ts       # Route handlers
│   ├── expenses/           # Expense tracking + fuel calculations
│   │   ├── repository.ts
│   │   └── routes.ts
│   ├── financing/          # Loan/lease management + payments
│   │   ├── hooks.ts        # Financing lifecycle hooks
│   │   ├── repository.ts
│   │   └── routes.ts
│   ├── insurance/          # Policy management
│   │   ├── repository.ts
│   │   └── routes.ts
│   ├── settings/           # User preferences + sync config
│   │   ├── repository.ts
│   │   └── routes.ts
│   └── sync/               # Backup, restore, Google integration
│       ├── activity-tracker.ts   # User activity + auto-sync triggers
│       ├── backup.ts             # Backup creation + validation
│       ├── google-drive.ts       # Google Drive file operations
│       ├── google-sheets.ts      # Google Sheets data mirroring
│       ├── restore.ts            # Data restoration
│       └── routes.ts             # Sync route handlers
├── db/                     # Database layer
│   ├── schema.ts           # Drizzle table definitions
│   ├── connection.ts       # SQLite connection + WAL config
│   ├── checkpoint.ts       # WAL checkpoint utility
│   ├── init.ts             # Database initialization
│   ├── seed.ts             # Sample data seeding
│   └── types.ts            # Database enums and types
├── middleware/             # Hono middleware stack
│   ├── auth.ts             # requireAuth / optionalAuth guards
│   ├── rate-limit.ts       # Per-user/IP rate limiting
│   ├── error-handler.ts    # Global error handler
│   ├── idempotency.ts      # Duplicate request prevention
│   ├── body-limit.ts       # Request size limiting (10MB)
│   ├── activity.ts         # Activity + change tracking for sync
│   └── index.ts            # Re-exports
├── utils/                  # Shared utilities
│   ├── calculations.ts     # MPG and cost calculations
│   ├── logger.ts           # Structured logging
│   ├── repository.ts       # BaseRepository class
│   ├── timeout.ts          # Async timeout wrapper
│   ├── unit-conversions.ts # Unit label helpers
│   ├── validation.ts       # Ownership validation helpers
│   └── vehicle-stats.ts    # Vehicle statistics
├── config.ts               # Zod-validated environment config
├── errors.ts               # Error classes, handlers, response formatters
├── types.ts                # Shared TypeScript types
└── index.ts                # App entry point + middleware composition
```

### Middleware Stack (applied in order)

1. Body Limit — prevents DoS via large payloads (10MB max)
2. Secure Headers — CSP, X-Frame-Options, HSTS, etc.
3. Rate Limiting — per-user/IP, configurable per route group
4. CORS — environment-based allowed origins
5. CSRF — origin validation on state-changing methods
6. Logging — request/response logging via Hono logger
7. Activity Tracking — monitors data changes for auto-sync

### API Versioning

All routes are mounted under `/api/v1/`:

```
/api/v1/auth/*        — Google OAuth flow, sessions
/api/v1/vehicles/*    — Vehicle CRUD
/api/v1/expenses/*    — Expense CRUD
/api/v1/financing/*   — Loan/lease management
/api/v1/insurance/*   — Insurance policies
/api/v1/settings/*    — User preferences
/api/v1/sync/*        — Backup, restore, Google sync
```

Legacy `/api/*` requests are redirected to `/api/v1/*` with HTTP 308.

### Repository Pattern

Each domain module uses a repository extending `BaseRepository` for data access:

```typescript
export class VehicleRepository extends BaseRepository<Vehicle, NewVehicle> {
  async findByUserId(userId: string): Promise<VehicleWithFinancing[]> { ... }
}

// Exported as singleton
export const vehicleRepository = new VehicleRepository(getDb());
```

No factory pattern or DI framework — direct exports for simplicity.

### Error Hierarchy

All errors are defined in `errors.ts`:

```
AppError (base, 500)
├── ValidationError (400)
├── AuthenticationError (401)
├── AuthorizationError (403)
├── NotFoundError (404)
├── ConflictError (409)
├── DatabaseError (500)
└── RateLimitError (429)

SyncError (separate hierarchy with SyncErrorCode enum)
├── AUTH_INVALID (401)
├── NETWORK_ERROR (503)
├── QUOTA_EXCEEDED (429)
├── PERMISSION_DENIED (403)
├── VALIDATION_ERROR (400)
├── CONFLICT_DETECTED (409)
└── SYNC_IN_PROGRESS (409)
```

### Database

SQLite with WAL mode via `bun:sqlite` + Drizzle ORM.

Tables: `users`, `vehicles`, `vehicle_financing`, `insurance_policies`, `expenses`, `user_settings`, `sessions`

Key SQLite PRAGMAs:
- `journal_mode = WAL` — concurrent reads
- `synchronous = NORMAL` — balanced durability/performance
- `foreign_keys = ON` — referential integrity
- `cache_size = 1000000` — large in-memory cache
- `wal_autocheckpoint = 1000` — auto-checkpoint after ~4MB of writes

Periodic WAL checkpoints run on a timer (5 min dev, 15 min prod) plus forced checkpoints on startup and shutdown.

Migrations are in `backend/drizzle/` and run automatically on startup via `drizzle-orm/bun-sqlite/migrator`.

### Sync Architecture

Two sync targets, both optional:

- **Google Drive Backup** — exports all user data as a ZIP of CSVs, uploads to Drive. Supports retention policies.
- **Google Sheets Sync** — mirrors user data to a spreadsheet for easy viewing.

Auto-sync is triggered by user inactivity:

```
User Activity → changeTracker marks data modified
    ↓
Inactivity timer expires (configurable, default 5 min)
    ↓
activityTracker checks for changes since last sync
    ↓
Triggers backup and/or sheets sync
```

---

## Frontend Architecture

### Directory Layout

```
frontend/src/lib/
├── components/          # Svelte components by domain
│   ├── analytics/       # Charts and analytics views
│   ├── charts/          # Shared chart components
│   ├── dashboard/       # Dashboard widgets
│   ├── expenses/        # Expense forms and tables
│   ├── financing/       # Financing management
│   ├── layout/          # Navigation, layout shells
│   ├── settings/        # Settings panels
│   ├── sync/            # Sync status and controls
│   ├── vehicles/        # Vehicle cards and forms
│   └── ui/              # shadcn-svelte primitives (do not modify)
├── services/            # API layer
│   ├── api-client.ts    # Base HTTP client (only place raw fetch is used)
│   ├── api-transformer.ts # Backend ↔ frontend type transforms
│   ├── vehicle-api.ts   # Vehicle endpoints
│   ├── expense-api.ts   # Expense endpoints
│   └── settings-api.ts  # Settings endpoints
├── stores/              # Svelte stores
│   ├── app.ts           # Global app state
│   ├── auth.ts          # Auth state
│   ├── offline.ts       # Offline detection
│   └── settings.ts      # User settings
├── types/
│   └── index.ts         # All TypeScript type definitions
├── utils/               # Shared utilities
│   ├── formatters.ts    # Date, currency, number formatting
│   ├── validation.ts    # Form validation helpers
│   ├── expense-filters.ts
│   ├── expense-helpers.ts
│   ├── financing-calculations.ts
│   ├── vehicle-helpers.ts
│   ├── chart-formatters.ts
│   ├── sync-status.ts
│   ├── sync-manager.ts
│   ├── units.ts
│   ├── memoize.ts
│   ├── transitions.ts
│   ├── accessibility.ts
│   ├── analytics-api.ts
│   ├── auth.ts
│   ├── error-handling.ts
│   ├── offline-storage.ts
│   ├── payment-planner.ts
│   ├── performance.ts
│   ├── pwa.ts
│   └── validation-rules.ts
├── constants/
│   ├── limits.ts
│   ├── messages.ts
│   ├── time-periods.ts
│   └── ui.ts
└── hooks/
    └── is-mobile.svelte.ts  # Reactive mobile detection hook
```

### Routes

SvelteKit file-based routing in `frontend/src/routes/`:

```
/                  — Landing / redirect
/auth/             — Login, OAuth callback
/dashboard/        — Main dashboard
/vehicles/         — Vehicle list and detail pages
/expenses/         — Expense list and management
/analytics/        — Charts and reports
/settings/         — User preferences, sync config
/profile/          — User profile
/trips/            — Trip tracking
```

### Key Patterns

- **Svelte 5 runes mode** — `$state()`, `$derived()`, `$effect()`, `$props()`. No legacy `$:` reactivity.
- **shadcn-svelte** for all UI primitives. Components in `ui/` are upstream-managed and not modified.
- **Semantic color tokens** throughout — `text-foreground`, `bg-background`, `border-input`, `chart-1`–`chart-5`.
- **Domain API services** (`vehicleApi`, `expenseApi`, `settingsApi`) wrap `apiClient` for type-safe API calls.
- **Expense categories**: `fuel`, `maintenance`, `financial`, `regulatory`, `enhancement`, `misc`.

---

## Data Flow

```
User Action (browser)
    ↓
SvelteKit Route → Component → Domain API Service
    ↓
apiClient (fetch with auth cookies)
    ↓
Hono Backend
    ↓
Body Limit → Security → Rate Limit → CORS → CSRF → Auth → Activity Tracking
    ↓
Route Handler → Zod Validation → Repository → Drizzle ORM → SQLite
    ↓
JSON Response → Component State Update
```

## Module Responsibilities

| Module | Purpose |
|--------|---------|
| Auth | Google OAuth flow, Lucia session management, cookie-based auth |
| Vehicles | Vehicle CRUD, statistics, ownership validation |
| Expenses | Expense tracking, fuel calculations, category management |
| Financing | Loan/lease management, payment tracking, amortization |
| Insurance | Policy management, term tracking |
| Sync | Google Drive backup (ZIP/CSV), Google Sheets mirroring, restore |
| Settings | User preferences (units, currency), sync configuration |

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| SQLite over Postgres | Single-file DB, no server needed, fast for single-user/family use, easy backup |
| Hono over Express | Lightweight, optimized for Bun, excellent TypeScript support |
| Direct repository exports (no DI) | Simpler code, easier to trace, testing via class exports |
| WAL mode | Concurrent reads without blocking writes |
| Svelte 5 runes | Modern reactivity model, better performance, cleaner component code |
| shadcn-svelte | Accessible, themeable UI primitives without vendor lock-in |
| layerchart over D3 direct | Svelte-native charting with better DX |
