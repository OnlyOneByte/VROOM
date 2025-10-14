# VROOM Backend - Database Foundation

A TypeScript backend built with Bun, Drizzle ORM, and SQLite for the VROOM car expense tracking application.

## Architecture Overview

The backend implements a clean repository pattern with comprehensive database schema for vehicle expense tracking, loan management, and insurance policy handling.

### Tech Stack
- **Runtime**: Bun (JavaScript runtime & package manager)
- **Database**: SQLite with WAL mode for performance
- **ORM**: Drizzle ORM with type-safe queries
- **Language**: TypeScript with strict type checking
- **Testing**: Bun's built-in test runner

## Database Schema

### Core Entities

**Users** - OAuth authentication support
```typescript
- id, email, name, picture
- oauthProvider, oauthId, refreshToken
- createdAt, updatedAt
```

**Vehicles** - Complete vehicle information
```typescript
- id, userId, make, model, year, licensePlate
- purchaseDate, purchasePrice, initialMileage
- createdAt, updatedAt
```

**Expenses** - Comprehensive expense tracking
```typescript
- id, vehicleId, amount, description, date, mileage
- category: operating, maintenance, financial, regulatory, enhancement, convenience
- type: 16 specific types (fuel, oil_change, insurance, etc.)
- gallons (for fuel efficiency tracking)
```

**Vehicle Loans** - Containerized loan information
```typescript
- id, vehicleId, loanAmount, interestRate, termMonths
- monthlyPayment, startDate, remainingBalance
```

**Loan Payments** - Payment history tracking
```typescript
- id, loanId, amount, principalAmount, interestAmount
- paymentDate, remainingBalance
```

**Insurance Policies** - Term-based policy management
```typescript
- id, vehicleId, provider, policyNumber, termMonths
- totalCost, monthlyCost (auto-calculated), startDate, endDate
```

## Repository Pattern

### Base Repository
All repositories extend `BaseRepository<T>` providing:
- `create(data)` - Insert new record
- `findById(id)` - Get by primary key
- `update(id, data)` - Update existing record
- `delete(id)` - Delete record
- `findAll()` - Get all records

### Specialized Repositories

**UserRepository**
```typescript
- findByEmail(email)
- findByOAuthId(provider, oauthId)
- updateRefreshToken(id, token)
```

**VehicleRepository**
```typescript
- findByUserId(userId)
- findByLicensePlate(licensePlate)
- findByUserIdAndId(userId, vehicleId)
```

**ExpenseRepository** - Analytics-enabled
```typescript
- findByVehicleId(vehicleId, options?)
- getCategoryTotals(vehicleId, startDate?, endDate?)
- getMonthlySummary(vehicleId, year)
- getFuelExpenses(vehicleId)
```

**VehicleLoanRepository**
```typescript
- findByVehicleId(vehicleId)
- updateRemainingBalance(id, balance)
- findActiveLoans(userId)
```

## Quick Start

### Installation
```bash
bun install
```

### Database Setup
```bash
# Generate and run migrations
bun run db:generate
bun run db:migrate

# Seed with sample data
bun run db:seed
```

### Development
```bash
# Start development server
bun run dev

# Run tests
bun test

# Database utilities
bun run db:studio  # Open Drizzle Studio
bun run db:reset   # Reset database
```

## Key Features

### Performance Optimizations
- **WAL Mode**: Write-Ahead Logging for concurrent access
- **Foreign Keys**: Enabled for referential integrity
- **Indexes**: Automatic indexing on primary/foreign keys
- **Connection Pooling**: Optimized single connection lifecycle

### Data Validation
- Comprehensive input validation with custom error types
- Business rule enforcement (loan balances, date constraints)
- Type-safe operations with Drizzle ORM

### Analytics Support
- Built-in expense categorization and totals
- Monthly expense summaries
- Fuel efficiency tracking (MPG calculations)
- Cost-per-mile metrics

### Error Handling
- Custom error types for different scenarios
- Database constraint violation handling
- Comprehensive logging and debugging

## File Structure

```
src/
├── db/
│   ├── schema.ts          # Database schema definitions
│   ├── connection.ts      # SQLite connection setup
│   ├── types.ts          # Type definitions & validation
│   ├── seed.ts           # Database seeding utilities
│   └── init.ts           # Database initialization
├── lib/
│   ├── repositories/     # Repository implementations
│   │   ├── interfaces.ts # Repository interfaces
│   │   ├── base.ts      # Base repository class
│   │   ├── user.ts      # User repository
│   │   ├── vehicle.ts   # Vehicle repository
│   │   ├── expense.ts   # Expense repository (with analytics)
│   │   └── factory.ts   # Repository factory
│   └── database.ts       # Database service & error handling
└── test/
    ├── integration/      # Integration tests
    └── setup.ts         # Test utilities
```

## Testing

Comprehensive test suite covering:
- Repository CRUD operations
- Data validation and constraints
- Foreign key relationships
- Analytics queries
- Error handling scenarios

```bash
# Run all tests
bun test

# Run specific test file
bun test src/test/integration/repositories.test.ts
```

## Next Steps

The database foundation supports the full VROOM feature set:
- ✅ Multi-vehicle management
- ✅ Comprehensive expense tracking
- ✅ Loan management with payment history
- ✅ Insurance policy management
- ✅ Analytics and reporting foundation
- ✅ Data export/import ready

Ready for API layer implementation with Hono framework.

## Environment Variables

```bash
# Database
DATABASE_URL="./data/vroom.db"

# Development
NODE_ENV="development"
```

See `.env.example` for complete configuration.