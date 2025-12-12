# VROOM Car Tracker Backend

A modern, type-safe backend API built with Bun, Hono, and Drizzle ORM for comprehensive vehicle expense tracking and management.

## 🚀 Tech Stack

- **Runtime**: [Bun](https://bun.sh/) - Fast JavaScript runtime with built-in bundler, test runner, and package manager
- **Framework**: [Hono](https://hono.dev/) - Lightweight, fast web framework for the edge
- **Database**: SQLite with [Drizzle ORM](https://orm.drizzle.team/) - Type-safe SQL toolkit
- **Authentication**: [Lucia Auth](https://lucia-auth.com/) with Google OAuth
- **Validation**: [Zod](https://zod.dev/) - TypeScript-first schema validation
- **Code Quality**: [Biome](https://biomejs.dev/) - Fast formatter and linter
- **Type Safety**: TypeScript with strict configuration

## 📁 Project Structure

```
backend/
├── src/
│   ├── db/                      # Database schema, migrations, and utilities
│   ├── lib/                     # Core utilities and services
│   │   ├── auth/               # Authentication (Lucia setup)
│   │   ├── constants/          # Configuration constants
│   │   │   ├── app-config.ts  # App-level config (database, pagination, session, time)
│   │   │   ├── sync.ts        # Sync and backup configuration
│   │   │   ├── validation.ts  # Validation limits
│   │   │   └── rate-limits.ts # Rate limiting configuration
│   │   ├── core/              # Core infrastructure
│   │   │   ├── config.ts      # Environment configuration
│   │   │   ├── database.ts    # Database service
│   │   │   └── errors/        # Consolidated error handling
│   │   │       ├── classes.ts    # Error classes
│   │   │       ├── handlers.ts   # Error handling logic
│   │   │       ├── responses.ts  # Response formatting
│   │   │       └── index.ts      # Unified exports
│   │   ├── middleware/        # Request/response interceptors
│   │   ├── repositories/      # Data access layer (simplified)
│   │   │   ├── base.ts       # BaseRepository with common CRUD
│   │   │   ├── query-builder.ts # Reusable query patterns
│   │   │   ├── index.ts      # Direct repository exports
│   │   │   └── [entity].ts   # Entity-specific repositories
│   │   ├── services/          # Business logic by domain
│   │   │   ├── analytics/    # Analytics and calculations
│   │   │   ├── integrations/ # External services (Google Drive/Sheets)
│   │   │   └── sync/         # Sync, backup, and restore operations
│   │   │       ├── backup-service.ts      # Backup creation/parsing/validation
│   │   │       ├── google-sync.ts         # Google Drive & Sheets sync
│   │   │       ├── sync-orchestrator.ts   # Sync coordination
│   │   │       ├── restore/               # Restore operations
│   │   │       └── tracking/              # Activity & change tracking
│   │   ├── types/             # Shared type definitions
│   │   │   ├── api-response.ts # API response types
│   │   │   ├── sync.ts        # Sync/backup types
│   │   │   ├── analytics.ts   # Analytics types
│   │   │   └── database.ts    # Database entity types
│   │   └── utils/             # Pure utility functions
│   │       ├── logger.ts      # Singleton logger
│   │       ├── timeout.ts     # Timeout utilities
│   │       └── unit-conversions.ts # Unit conversion helpers
│   ├── routes/                # API route handlers
│   ├── types/                 # API-specific types and enums
│   └── index.ts               # Application entry point
├── drizzle/                   # Database migrations
├── data/                      # SQLite database files
└── dist/                      # Build output
```

## 🛠️ Setup & Installation

### Prerequisites

- [Bun](https://bun.sh/) v1.0.0 or higher
- Node.js v18+ (for compatibility)

### Installation

1. **Clone and navigate to backend directory**
   ```bash
   cd backend
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Environment Configuration**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your configuration:
   ```env
   # Required for Google OAuth
   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   SESSION_SECRET=your_32_character_secret
   
   # Optional configurations
   PORT=3001
   DATABASE_URL=./data/vroom.db
   LOG_LEVEL=info
   ```

4. **Database Setup**
   ```bash
   # Generate and apply migrations
   bun run db:generate
   bun run db:push
   
   # Initialize database with schema
   bun run db:init
   
   # Optional: Seed with sample data
   bun run db:seed
   ```

5. **Start Development Server**
   ```bash
   bun run dev
   ```

## 🔧 Available Scripts

### Development
- `bun run dev` - Start development server with hot reload
- `bun run build` - Build for production
- `bun run start` - Start production server

### Database
- `bun run db:generate` - Generate database migrations
- `bun run db:push` - Apply migrations to database
- `bun run db:studio` - Open Drizzle Studio (database GUI)
- `bun run db:init` - Initialize database schema
- `bun run db:seed` - Seed database with sample data
- `bun run db:checkpoint` - Manually checkpoint WAL to persist data
- `bun run db:checkpoint:force` - Force checkpoint (use if data seems lost)

### Code Quality
- `bun run lint` - Run Biome linter
- `bun run lint:fix` - Fix linting issues automatically
- `bun run format` - Check code formatting
- `bun run format:fix` - Fix formatting issues
- `bun run check` - Run both linting and formatting checks
- `bun run check:fix` - Fix all code quality issues
- `bun run type-check` - Run TypeScript type checking

### Testing
- `bun run test` - Run all tests
- `bun run test:repositories` - Run repository tests
- `bun run test:auth` - Run authentication tests
- `bun run test:vehicles` - Run vehicle management tests

## 🔐 Authentication Setup

### Google OAuth Configuration

1. **Create Google Cloud Project**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing one

2. **Enable Google+ API**
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google+ API" and enable it

3. **Create OAuth 2.0 Credentials**
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth 2.0 Client IDs"
   - Set application type to "Web application"
   - Add authorized redirect URIs:
     - Development: `http://localhost:3001/auth/callback/google`
     - Production: `https://yourdomain.com/auth/callback/google`

4. **Configure Environment Variables**
   ```env
   GOOGLE_CLIENT_ID=your_client_id_here
   GOOGLE_CLIENT_SECRET=your_client_secret_here
   GOOGLE_REDIRECT_URI=http://localhost:3001/auth/callback/google
   ```

## 📊 API Documentation

### Base URL
- Development: `http://localhost:3001`
- Production: `https://your-api-domain.com`

### Authentication Endpoints
- `GET /auth/login/google` - Initiate Google OAuth flow
- `GET /auth/callback/google` - OAuth callback handler
- `GET /auth/me` - Get current user info
- `POST /auth/logout` - Logout user
- `POST /auth/refresh` - Refresh session

### API Endpoints
- `GET /api/vehicles` - List user's vehicles
- `POST /api/vehicles` - Create new vehicle
- `GET /api/vehicles/:id` - Get specific vehicle
- `PUT /api/vehicles/:id` - Update vehicle
- `DELETE /api/vehicles/:id` - Delete vehicle

- `GET /api/expenses` - List expenses
- `POST /api/vehicles/:id/expenses` - Add expense to vehicle
- `PUT /api/expenses/:id` - Update expense
- `DELETE /api/expenses/:id` - Delete expense

- `GET /api/analytics/dashboard` - Get dashboard analytics
- `GET /api/analytics/vehicle/:id` - Get vehicle-specific analytics

### Response Format
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation completed successfully"
}
```

### Error Response Format
```json
{
  "error": "ValidationError",
  "message": "Invalid request data",
  "statusCode": 400,
  "details": { ... }
}
```

## 🏗️ Architecture & Design Patterns

### Simplified Repository Pattern (No Factory)

The codebase uses a **direct export pattern** instead of a factory pattern for simplicity:

```typescript
// repositories/index.ts - Direct singleton exports
export const userRepository = new UserRepository(db);
export const vehicleRepository = new VehicleRepository(db);

// For testing, classes are also exported
export { UserRepository, VehicleRepository };
```

**Why no factory pattern?**
- No dependency injection framework in use
- Simpler code with fewer abstractions
- Direct imports are easier to understand and trace
- Testing is still possible by exporting classes
- Reduces boilerplate and complexity

**Repository Features:**
- Consistent CRUD operations via `BaseRepository`
- Unified error handling with typed errors
- `QueryBuilder` for reusable query patterns
- Comprehensive logging for all operations

### Consolidated Error System

All error handling is centralized in `lib/core/errors/`:

```typescript
// Organized into three modules:
errors/
├── classes.ts    # Error classes (AppError, ValidationError, SyncError, etc.)
├── handlers.ts   # Error handling logic (handleDatabaseError, etc.)
├── responses.ts  # Response formatting (createErrorResponse, etc.)
└── index.ts      # Unified exports
```

**Benefits:**
- Single source of truth for error handling
- Consistent error responses across all endpoints
- Clear separation: classes, handlers, responses
- Easy to extend with new error types

### Service Layer Organization

Services are organized by **business domain**:

```
services/
├── analytics/      # Analytics calculations and reporting
├── integrations/   # External service integrations (Google)
└── sync/          # Sync, backup, restore, and tracking
    ├── backup-service.ts
    ├── google-sync.ts
    ├── sync-orchestrator.ts
    ├── restore/
    └── tracking/
```

**Key Principles:**
- Domain-driven organization
- Services depend on repositories (injected via constructor)
- Orchestrators coordinate multiple services
- Clear boundaries between domains

### Middleware Architecture
- Authentication middleware for protected routes
- Rate limiting for API protection
- Error handling delegates to `core/errors`
- Activity tracking delegates to services
- Request logging and monitoring

### Type Safety
- Comprehensive TypeScript types
- Zod schema validation in routes
- Centralized type definitions in `lib/types/`
- Database schema types from Drizzle
- API request/response type definitions

## 🔒 Security Features

- **Authentication**: Secure OAuth 2.0 with Google
- **Session Management**: HTTP-only cookies with CSRF protection
- **Rate Limiting**: Configurable request rate limiting
- **Input Validation**: Comprehensive request validation with Zod
- **SQL Injection Protection**: Parameterized queries with Drizzle ORM
- **CORS Configuration**: Environment-based CORS origins

## 🚀 Deployment

### Docker Deployment
```dockerfile
FROM oven/bun:1 as base
WORKDIR /app

# Install dependencies
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build application
RUN bun run build

# Expose port
EXPOSE 3001

# Start application
CMD ["bun", "run", "start"]
```

### Environment Variables for Production
```env
NODE_ENV=production
PORT=3001
HOST=0.0.0.0
DATABASE_URL=/app/data/vroom.db
GOOGLE_REDIRECT_URI=https://yourdomain.com/auth/callback/google
CORS_ORIGINS=https://yourdomain.com
LOG_LEVEL=warn
```

## 🧪 Testing

The backend includes comprehensive test suites:

- **Unit Tests**: Repository layer testing
- **Integration Tests**: API endpoint testing
- **Authentication Tests**: OAuth flow testing
- **Database Tests**: Schema and migration testing

Run tests with:
```bash
bun run test
```

## 💾 Data Persistence & WAL Mode

### Understanding SQLite WAL Mode

The backend uses SQLite's Write-Ahead Logging (WAL) mode for better performance and concurrency. However, this can cause data to appear "lost" during development with hot reload.

### How WAL Works

1. **Write Operations**: Data is first written to the WAL file (`vroom.db-wal`)
2. **Checkpoint**: Periodically, data is moved from WAL to the main database file (`vroom.db`)
3. **Hot Reload Issue**: When the backend restarts (hot reload), uncommitted WAL data might not be visible

### Automatic Solutions Implemented

- **Frequent Checkpoints**: Automatic checkpoint every 30 seconds in development (5 minutes in production)
- **Auto-checkpoint**: SQLite configured to checkpoint after 100 pages (~400KB) of writes
- **Post-Write Checkpoint**: Automatic checkpoint after successful write operations (POST/PUT/DELETE)
- **Startup Checkpoint**: Force checkpoint on server startup to ensure previous data is visible
- **Shutdown Checkpoint**: Force checkpoint on graceful shutdown

### Manual Checkpoint (If Needed)

If you notice data seems to disappear after backend restart:

```bash
# Normal checkpoint
bun run db:checkpoint

# Force checkpoint (more aggressive)
bun run db:checkpoint:force
```

### Why This Happens

During development with `bun --hot`, the server restarts frequently. If data is written to the WAL file but not yet checkpointed to the main database file, it might not be visible after restart. The fixes above ensure data is persisted more frequently.

### Production Considerations

In production, this is less of an issue because:
- Server restarts are infrequent
- Graceful shutdown ensures proper checkpoint
- Longer checkpoint intervals are acceptable
- Docker volumes ensure data persistence

## 📈 Performance Optimizations

- **Bun Runtime**: Fast JavaScript execution and built-in optimizations
- **SQLite WAL Mode**: Improved concurrent read performance
- **Connection Pooling**: Efficient database connection management
- **Response Caching**: Strategic caching for analytics endpoints
- **Compression**: Gzip compression for API responses
- **Smart Checkpointing**: Balanced between data safety and performance

## 🔧 Development Tools

- **Drizzle Studio**: Visual database management
- **Biome**: Fast linting and formatting
- **TypeScript**: Strict type checking
- **Hot Reload**: Automatic server restart on changes

## 🔄 Migration Notes for Developers

### Recent Refactoring (Code Consolidation)

The codebase underwent a major consolidation to improve organization and reduce duplication. Here are the key changes:

#### Error Handling
- **Old**: Errors split across `core/errors.ts`, `utils/error-handler.ts`, `utils/error-response.ts`
- **New**: Consolidated into `core/errors/` directory with classes, handlers, and responses
- **Migration**: Update imports to `from '../core/errors'`

#### Repository Pattern
- **Old**: Factory pattern with `repositories/factory.ts` and `repositories/interfaces.ts`
- **New**: Direct exports from `repositories/index.ts`
- **Migration**: 
  ```typescript
  // Old
  import { createRepositories } from './repositories/factory';
  const repos = createRepositories(db);
  
  // New
  import { userRepository, vehicleRepository } from './repositories';
  ```

#### Service Organization
- **Old**: Services scattered, tracking at top level, `services/google/`
- **New**: Domain-organized under `services/analytics/`, `services/integrations/`, `services/sync/`
- **Migration**: Update import paths to new locations

#### Constants
- **Old**: Many small constant files (`database.ts`, `pagination.ts`, `session.ts`, `time.ts`, `backup.ts`)
- **New**: Merged into `app-config.ts` and `sync.ts`
- **Migration**:
  ```typescript
  // Old
  import { DEFAULT_PAGE_SIZE } from './constants/pagination';
  
  // New
  import { APP_CONFIG } from './constants/app-config';
  const pageSize = APP_CONFIG.PAGINATION.DEFAULT_PAGE_SIZE;
  ```

#### Type Definitions
- **Old**: Types scattered in service directories
- **New**: Centralized in `lib/types/` (sync.ts, analytics.ts, database.ts)
- **Migration**: Import types from `lib/types` instead of service directories

#### Removed Files
The following files were removed (functionality merged elsewhere):
- `lib/utils/error-handler.ts` → `lib/core/errors/handlers.ts`
- `lib/utils/error-response.ts` → `lib/core/errors/responses.ts`
- `lib/utils/query-builder.ts` → `lib/repositories/query-builder.ts`
- `lib/repositories/factory.ts` (removed - no longer needed)
- `lib/repositories/interfaces.ts` (removed - no longer needed)
- `lib/auth/lucia-provider.ts` → merged into `lib/auth/lucia.ts`
- Multiple backup/sync files merged into `backup-service.ts` and `google-sync.ts`

## 📝 Contributing

1. Follow the established code style (enforced by Biome)
2. Write tests for new features
3. Update documentation for API changes
4. Use conventional commit messages
5. Ensure all checks pass before submitting PRs
6. When adding new features, follow the established patterns:
   - Use direct repository exports (no factory)
   - Organize services by domain
   - Use centralized error handling from `core/errors`
   - Add types to `lib/types/` for shared definitions

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.