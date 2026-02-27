# VROOM Backend Architecture

## Overview

The VROOM backend is a RESTful API built with Hono, Bun, and SQLite. It follows a clean, modular architecture designed for readability and maintainability.

## Technology Stack

- **Runtime**: Bun (fast JavaScript runtime)
- **Framework**: Hono (lightweight web framework)
- **Database**: SQLite with Drizzle ORM
- **Authentication**: Lucia Auth with Google OAuth
- **Validation**: Zod
- **Language**: TypeScript

## Project Structure

```
backend/src/
├── api/               # API modules (domain logic)
│   ├── auth/          # Authentication (OAuth, sessions)
│   │   ├── lucia.ts       # Lucia auth setup
│   │   ├── routes.ts      # Auth route handlers
│   │   └── utils.ts       # Auth utilities
│   ├── expenses/      # Expense tracking module
│   │   ├── repository.ts  # Expense data access
│   │   └── routes.ts      # Expense route handlers
│   ├── financing/     # Vehicle financing module
│   │   ├── repository.ts  # Financing data access
│   │   └── routes.ts      # Financing route handlers
│   ├── insurance/     # Insurance policy module
│   │   ├── repository.ts  # Insurance data access
│   │   └── routes.ts      # Insurance route handlers
│   ├── settings/      # User settings module
│   │   ├── repository.ts  # Settings data access
│   │   └── routes.ts      # Settings route handlers
│   ├── sync/          # Backup/restore and Google integration
│   │   ├── activity-tracker.ts  # User activity & auto-sync
│   │   ├── backup.ts           # Backup creation & validation
│   │   ├── google-drive.ts     # Google Drive file operations
│   │   ├── google-sheets.ts    # Google Sheets data sync
│   │   ├── restore.ts          # Data restoration
│   │   └── routes.ts           # Sync route handlers
│   └── vehicles/      # Vehicle management module
│       ├── repository.ts  # Vehicle data access
│       └── routes.ts      # Vehicle route handlers
├── db/                # Database (schema, migrations, connection)
│   ├── checkpoint.ts      # WAL checkpoint utility
│   ├── connection.ts      # Database connection setup
│   ├── init.ts            # Database initialization
│   ├── schema.ts          # Drizzle table definitions
│   ├── seed.ts            # Sample data seeding
│   └── types.ts           # Database enums and types
├── middleware/        # Request middleware
│   ├── activity.ts        # Activity & change tracking
│   ├── auth.ts            # Authentication guards
│   ├── body-limit.ts      # Request size limiting
│   ├── error-handler.ts   # Global error handler
│   ├── idempotency.ts     # Duplicate request prevention
│   ├── index.ts           # Middleware re-exports
│   └── rate-limit.ts      # Rate limiting
├── utils/             # Shared utilities
│   ├── calculations.ts        # MPG and cost calculations
│   ├── logger.ts              # Logging utility
│   ├── repository.ts          # BaseRepository class
│   ├── timeout.ts             # Async timeout wrapper
│   ├── unit-conversions.ts    # Unit label helpers
│   ├── validation.ts          # Ownership validation helpers
│   └── vehicle-stats.ts       # Vehicle statistics
├── config.ts          # Configuration and environment variables
├── errors.ts          # Error classes and handlers
├── index.ts           # Application entry point
└── types.ts           # Shared TypeScript types
```

## Architecture Patterns

### 1. Repository Pattern

Each module uses a repository for database operations:

```typescript
export class VehicleRepository extends BaseRepository<Vehicle, NewVehicle> {
  async findByUserId(userId: string): Promise<VehicleWithFinancing[]> { }
}
```

Repositories are exported as singletons for simplicity:

```typescript
export const vehicleRepository = new VehicleRepository(getDb());
```

### 2. Route Handlers

Routes are organized by resource and follow RESTful conventions:

```
GET    /api/v1/vehicles       - List vehicles
POST   /api/v1/vehicles       - Create vehicle
GET    /api/v1/vehicles/:id   - Get vehicle
PUT    /api/v1/vehicles/:id   - Update vehicle
DELETE /api/v1/vehicles/:id   - Delete vehicle
```

### 3. Middleware Stack

Middleware is applied in layers:

1. **Body Limit**: Prevents DoS via large payloads
2. **Security**: Secure headers, CORS, CSRF
3. **Rate Limiting**: Prevent abuse
4. **Authentication**: Session validation
5. **Activity Tracking**: For auto-sync
6. **Error Handling**: Consistent error responses

### 4. Validation

Input validation uses Zod schemas derived from database schema:

```typescript
const createVehicleSchema = createInsertSchema(vehiclesTable, {
  make: z.string().min(1).max(50),
  year: z.number().int().min(1900),
});
```

## Key Design Decisions

### Why SQLite?

- Single file database, no server needed
- Fast for read-heavy workloads
- Easy to backup and restore
- WAL mode for concurrent reads

### Why Hono?

- Lightweight with minimal overhead
- Optimized for Bun runtime
- Excellent TypeScript support
- Clean middleware composition

### Why Direct Repository Exports (No DI)?

- Simpler code with fewer abstractions
- Direct imports are easier to trace
- Testing is still possible by exporting classes
- Reduces boilerplate and complexity

## Data Flow

```
Client Request
    ↓
Body Limit → Security Headers → CORS → CSRF
    ↓
Rate Limiting
    ↓
Authentication (if required)
    ↓
Route Handler → Validation (Zod) → Repository (Database)
    ↓
Response
```

## Sync Architecture

The sync module supports two sync targets:

- **Google Drive Backup**: Exports all user data as a ZIP file containing CSV files and uploads to Google Drive. Supports retention policies to auto-delete old backups.
- **Google Sheets Sync**: Mirrors user data to a Google Sheets spreadsheet for easy viewing/editing.

Auto-sync is triggered by user inactivity (configurable delay). The activity tracker monitors data changes and triggers sync when the user goes idle.

```
User Activity → Change Tracker marks data changed
    ↓
Inactivity Timer expires
    ↓
Activity Tracker checks for changes since last sync
    ↓
Triggers backup and/or sheets sync
```

## Error Handling

### Error Hierarchy

```
AppError (base)
├── ValidationError (400)
├── AuthenticationError (401)
├── AuthorizationError (403)
├── NotFoundError (404)
├── ConflictError (409)
├── DatabaseError (500)
├── RateLimitError (429)
└── SyncError (variable status)
```

## Module Responsibilities

| Module | Purpose |
|--------|---------|
| Auth | Google OAuth flow, session management |
| Vehicles | Vehicle CRUD, statistics, ownership |
| Expenses | Expense tracking, fuel calculations |
| Financing | Loan/lease management, payments |
| Insurance | Policy management, expiration alerts |
| Sync | Backup/restore, Google Drive/Sheets |
| Settings | User preferences, sync configuration |
