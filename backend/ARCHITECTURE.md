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
│   ├── expenses/      # Expense tracking module
│   ├── financing/     # Vehicle financing module
│   ├── insurance/     # Insurance policy module
│   ├── settings/      # User settings module
│   ├── sync/          # Backup/restore and Google integration
│   └── vehicles/      # Vehicle management module
├── db/                # Database (schema, migrations, connection)
├── middleware/        # Request middleware (auth, rate limiting, etc.)
├── utils/             # Shared utilities
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
  // Custom queries specific to vehicles
  async findByUserId(userId: string): Promise<Vehicle[]> { }
}
```

**Benefits:**
- Consistent database access patterns
- Easy to test (can mock repositories)
- Encapsulates database logic

### 2. Route Handlers

Routes are organized by resource and follow RESTful conventions:

```typescript
// GET    /api/vehicles       - List vehicles
// POST   /api/vehicles       - Create vehicle
// GET    /api/vehicles/:id   - Get vehicle
// PUT    /api/vehicles/:id   - Update vehicle
// DELETE /api/vehicles/:id   - Delete vehicle
```

### 3. Middleware Stack

Middleware is applied in layers:

1. **Security**: CORS, CSRF, secure headers
2. **Rate Limiting**: Prevent abuse
3. **Authentication**: Session validation
4. **Activity Tracking**: For auto-sync
5. **Error Handling**: Consistent error responses

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

- **Simplicity**: Single file database, no server needed
- **Performance**: Fast for read-heavy workloads
- **Portability**: Easy to backup and restore
- **WAL Mode**: Concurrent reads with single writer

### Why Hono?

- **Lightweight**: Minimal overhead
- **Fast**: Optimized for Bun runtime
- **Type-safe**: Excellent TypeScript support
- **Middleware**: Clean middleware composition

### Why Repository Pattern?

- **Testability**: Easy to mock for unit tests
- **Consistency**: Standardized CRUD operations
- **Flexibility**: Custom queries when needed

## Data Flow

### Request Flow

```
Client Request
    ↓
Security Middleware (CORS, CSRF, Headers)
    ↓
Rate Limiting
    ↓
Authentication (if required)
    ↓
Route Handler
    ↓
Validation (Zod)
    ↓
Repository (Database)
    ↓
Response
```

### Error Flow

```
Error Thrown
    ↓
Error Handler Middleware
    ↓
Error Classification
    ↓
Logging (warn for 4xx, error for 5xx)
    ↓
Formatted Response
```

## Module Responsibilities

### Auth Module
- Google OAuth flow
- Session management
- Token refresh
- User authentication

### Vehicles Module
- Vehicle CRUD operations
- Vehicle statistics
- Fuel efficiency calculations
- Ownership validation

### Expenses Module
- Expense tracking
- Category management
- Fuel expense validation
- Date range queries

### Financing Module
- Loan/lease management
- Payment tracking
- Balance calculations
- Payment schedules

### Insurance Module
- Policy management
- Expiration tracking
- Monthly cost breakdown
- Active policy queries

### Sync Module
- Backup creation (ZIP format)
- Data restoration
- Google Drive integration
- Google Sheets sync
- Conflict detection

### Settings Module
- User preferences
- Unit conversions
- Sync configuration
- Backup settings

## Security Measures

1. **Authentication**: OAuth 2.0 with Google
2. **Session Management**: Secure, HTTP-only cookies
3. **CSRF Protection**: Token-based validation
4. **Rate Limiting**: Per-user and global limits
5. **Input Validation**: Zod schema validation
6. **SQL Injection**: Prevented by Drizzle ORM
7. **Secure Headers**: CSP, X-Frame-Options, etc.

## Performance Optimizations

1. **Database**:
   - WAL mode for concurrent reads
   - Indexed foreign keys
   - Efficient queries with joins

2. **Caching**:
   - In-memory rate limit store
   - Idempotency cache
   - Activity tracking cache

3. **Connection Pooling**:
   - Single SQLite connection
   - Automatic WAL checkpoints

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
└── RateLimitError (429)
```

### Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": { /* optional */ }
  }
}
```

## Testing Strategy

### Unit Tests
- Repository methods
- Utility functions
- Validation logic

### Integration Tests
- API endpoints
- Authentication flow
- Database operations

### Test Database
- Separate test database
- Automatic cleanup
- Isolated test environment

## Deployment Considerations

### Single Instance
- In-memory stores work fine
- Simple deployment
- No distributed concerns

### Multiple Instances
- Use Redis for:
  - Rate limiting
  - OAuth state
  - Activity tracking
- Shared database
- Load balancer

### Environment Variables

Required:
- `DATABASE_URL`: SQLite database path
- `GOOGLE_CLIENT_ID`: OAuth client ID
- `GOOGLE_CLIENT_SECRET`: OAuth client secret
- `SESSION_SECRET`: Session encryption key

Optional:
- `PORT`: Server port (default: 3001)
- `FRONTEND_URL`: Frontend URL for CORS
- `LOG_LEVEL`: Logging verbosity

## Future Improvements

1. **Service Layer**: Extract complex business logic
2. **Event System**: Decouple modules with events
3. **Caching Layer**: Redis for distributed caching
4. **API Documentation**: OpenAPI/Swagger
5. **Request Tracing**: Correlation IDs
6. **Health Checks**: Dependency monitoring
7. **Metrics**: Prometheus/Grafana
8. **Background Jobs**: Queue system for async tasks

## Contributing Guidelines

1. **Code Style**: Follow existing patterns
2. **Type Safety**: Use TypeScript strictly
3. **Error Handling**: Use custom error classes
4. **Validation**: Validate all inputs with Zod
5. **Documentation**: Comment complex logic
6. **Testing**: Add tests for new features
7. **Security**: Follow security best practices

## Resources

- [Hono Documentation](https://hono.dev/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Lucia Auth](https://lucia-auth.com/)
- [Zod Validation](https://zod.dev/)
- [SQLite Documentation](https://www.sqlite.org/docs.html)
