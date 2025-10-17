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
│   ├── db/                 # Database schema, migrations, and utilities
│   ├── lib/                # Core utilities and services
│   │   ├── auth/          # Authentication providers and utilities
│   │   ├── middleware/    # Custom middleware (auth, rate limiting, etc.)
│   │   ├── repositories/  # Data access layer
│   │   └── validation/    # Zod schemas and validation utilities
│   ├── routes/            # API route handlers
│   ├── types/             # TypeScript type definitions and enums
│   └── index.ts           # Application entry point
├── drizzle/               # Database migrations
├── data/                  # SQLite database files
└── dist/                  # Build output
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

### Repository Pattern
- Abstracted data access layer
- Consistent CRUD operations
- Easy testing and mocking
- Database-agnostic interface

### Middleware Architecture
- Authentication middleware for protected routes
- Rate limiting for API protection
- Error handling with proper HTTP status codes
- Request logging and monitoring

### Type Safety
- Comprehensive TypeScript types
- Zod schema validation
- Database schema types from Drizzle
- API request/response type definitions

### Error Handling
- Custom error classes with proper HTTP status codes
- Centralized error handling middleware
- Development vs production error responses
- Structured error logging

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
RATE_LIMIT_MAX_REQUESTS=100
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

## 📝 Contributing

1. Follow the established code style (enforced by Biome)
2. Write tests for new features
3. Update documentation for API changes
4. Use conventional commit messages
5. Ensure all checks pass before submitting PRs

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.