# VROOM Development Guide

Guide for setting up a development environment and contributing to VROOM.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Code Style](#code-style)
- [Contributing](#contributing)

## Prerequisites

### Required Software

- **Node.js**: v18+ (for frontend)
- **Bun**: Latest version (for backend)
- **Docker**: v20.10+ (optional, for containerized development)
- **Git**: For version control

### Installation

#### Install Node.js

```bash
# Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18

# Or download from nodejs.org
```

#### Install Bun

```bash
# macOS/Linux
curl -fsSL https://bun.sh/install | bash

# Windows (WSL recommended)
# Follow instructions at https://bun.sh
```

#### Install Docker (Optional)

```bash
# macOS
brew install --cask docker

# Linux
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Windows
# Download Docker Desktop from docker.com
```

## Development Setup

### 1. Clone Repository

```bash
git clone https://github.com/your-username/vroom.git
cd vroom
```

### 2. Backend Setup

```bash
cd backend

# Install dependencies
bun install

# Copy environment file
cp .env.example .env

# Edit .env with your development settings
nano .env
```

**Development .env:**
```env
NODE_ENV=development
PORT=3001
HOST=0.0.0.0

DATABASE_URL=./data/vroom.db

GOOGLE_CLIENT_ID=your_dev_client_id
GOOGLE_CLIENT_SECRET=your_dev_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/callback/google

SESSION_SECRET=dev_session_secret_change_in_production

CORS_ORIGINS=http://localhost:5173

LOG_LEVEL=debug
```

#### Initialize Database

```bash
# Create database and run migrations
bun run db:init

# Optional: Seed with test data
bun run db:seed
```

#### Start Backend Development Server

```bash
# Start with hot reload
bun run dev

# Or start normally
bun run start
```

Backend will be available at `http://localhost:3001`

### 3. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env
nano .env
```

**Development .env:**
```env
PUBLIC_API_URL=http://localhost:3001
```

#### Start Frontend Development Server

```bash
# Start with hot reload
npm run dev

# Or build and preview
npm run build
npm run preview
```

Frontend will be available at `http://localhost:5173`

### 4. Docker Development (Alternative)

```bash
# From project root
docker-compose up

# Or in detached mode
docker-compose up -d

# View logs
docker-compose logs -f
```

This starts both frontend and backend with hot reload enabled.

## Project Structure

```
vroom/
├── backend/                 # Bun backend
│   ├── src/
│   │   ├── db/             # Database schema and migrations
│   │   │   ├── schema.ts   # Drizzle ORM schema
│   │   │   ├── connection.ts
│   │   │   └── seed.ts
│   │   ├── lib/            # Business logic
│   │   │   ├── auth/       # Lucia authentication
│   │   │   ├── repositories/ # Data access layer
│   │   │   ├── middleware/ # Express middleware
│   │   │   ├── google-drive.ts
│   │   │   └── google-sheets.ts
│   │   ├── routes/         # API routes
│   │   ├── types/          # TypeScript types
│   │   └── index.ts        # Entry point
│   ├── test/               # Backend tests
│   ├── drizzle/            # Database migrations
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/               # SvelteKit frontend
│   ├── src/
│   │   ├── lib/
│   │   │   ├── components/ # Svelte components
│   │   │   ├── stores/     # Svelte stores
│   │   │   ├── utils/      # Utility functions
│   │   │   └── types/      # TypeScript types
│   │   ├── routes/         # SvelteKit routes
│   │   │   ├── +layout.svelte
│   │   │   ├── +page.svelte
│   │   │   ├── dashboard/
│   │   │   ├── vehicles/
│   │   │   └── login/
│   │   ├── app.html        # HTML template
│   │   └── app.css         # Global styles
│   ├── e2e/                # Playwright E2E tests
│   ├── static/             # Static assets
│   ├── package.json
│   ├── svelte.config.js
│   ├── vite.config.ts
│   └── playwright.config.ts
│
├── docs/                   # Documentation
├── scripts/                # Utility scripts
├── .github/                # GitHub Actions workflows
├── docker-compose.yml      # Development compose
├── docker-compose.prod.yml # Production compose
└── README.md
```

## Development Workflow

### Making Changes

1. **Create a feature branch:**
```bash
git checkout -b feature/your-feature-name
```

2. **Make your changes:**
   - Write code
   - Add tests
   - Update documentation

3. **Test your changes:**
```bash
# Backend tests
cd backend
bun test

# Frontend tests
cd frontend
npm test

# E2E tests
npm run test:e2e
```

4. **Commit your changes:**
```bash
git add .
git commit -m "feat: add your feature description"
```

5. **Push and create PR:**
```bash
git push origin feature/your-feature-name
# Create Pull Request on GitHub
```

### Commit Message Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting)
- `refactor:` Code refactoring
- `test:` Adding or updating tests
- `chore:` Maintenance tasks

Examples:
```bash
git commit -m "feat: add fuel efficiency tracking"
git commit -m "fix: resolve database lock issue"
git commit -m "docs: update installation guide"
```

### Database Changes

#### Create Migration

```bash
cd backend

# Make changes to src/db/schema.ts

# Generate migration
bun run db:generate

# Apply migration
bun run db:push
```

#### Seed Database

```bash
# Run seed script
bun run db:seed

# Or create custom seed
bun run src/db/seed.ts
```

### API Development

#### Adding New Endpoint

1. **Create route file:**
```typescript
// backend/src/routes/example.ts
import { Hono } from 'hono';

const example = new Hono();

example.get('/', async (c) => {
  return c.json({ message: 'Hello' });
});

export default example;
```

2. **Register route:**
```typescript
// backend/src/index.ts
import example from './routes/example';

app.route('/api/example', example);
```

3. **Add tests:**
```typescript
// backend/src/test/integration/example.test.ts
import { describe, it, expect } from 'bun:test';

describe('Example API', () => {
  it('should return hello message', async () => {
    const response = await fetch('http://localhost:3001/api/example');
    const data = await response.json();
    expect(data.message).toBe('Hello');
  });
});
```

### Frontend Development

#### Creating Components

```svelte
<!-- frontend/src/lib/components/Example.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  
  let data = $state<string>('');
  
  onMount(async () => {
    const response = await fetch('/api/example');
    const json = await response.json();
    data = json.message;
  });
</script>

<div class="example">
  <h1>{data}</h1>
</div>

<style>
  .example {
    padding: 1rem;
  }
</style>
```

#### Adding Routes

```svelte
<!-- frontend/src/routes/example/+page.svelte -->
<script lang="ts">
  import Example from '$lib/components/Example.svelte';
</script>

<Example />
```

#### Using Stores

```typescript
// frontend/src/lib/stores/example.ts
import { writable } from 'svelte/store';

export const exampleStore = writable<string>('');
```

```svelte
<!-- In component -->
<script lang="ts">
  import { exampleStore } from '$lib/stores/example';
</script>

<p>{$exampleStore}</p>
```

## Testing

### Backend Tests

```bash
cd backend

# Run all tests
bun test

# Run specific test file
bun test src/test/integration/auth.test.ts

# Run with coverage
bun test --coverage

# Watch mode
bun test --watch
```

### Frontend Unit Tests

```bash
cd frontend

# Run all tests
npm test

# Run specific test
npm test -- src/lib/components/__tests__/Example.test.ts

# Watch mode
npm run test:watch

# With UI
npm run test:ui
```

### E2E Tests

```bash
cd frontend

# Run all E2E tests
npm run test:e2e

# Run with UI
npm run test:e2e:ui

# Run specific browser
npm run test:e2e:chromium

# Run mobile tests
npm run test:e2e:mobile

# Debug mode
npx playwright test --debug
```

### Writing Tests

#### Backend Test Example

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createTestDatabase, cleanupTestDatabase } from './utils/test-helpers';

describe('Vehicle Repository', () => {
  beforeAll(async () => {
    await createTestDatabase();
  });

  afterAll(async () => {
    await cleanupTestDatabase();
  });

  it('should create a vehicle', async () => {
    const vehicle = await vehicleRepo.create({
      userId: 'user123',
      make: 'Toyota',
      model: 'Camry',
      year: 2020
    });

    expect(vehicle.id).toBeDefined();
    expect(vehicle.make).toBe('Toyota');
  });
});
```

#### Frontend Test Example

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Example from '../Example.svelte';

describe('Example Component', () => {
  it('should render message', () => {
    render(Example, { props: { message: 'Hello' } });
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
```

#### E2E Test Example

```typescript
import { test, expect } from '@playwright/test';

test('should add a vehicle', async ({ page }) => {
  await page.goto('/dashboard');
  
  await page.getByRole('button', { name: /add vehicle/i }).click();
  
  await page.getByLabel(/make/i).fill('Toyota');
  await page.getByLabel(/model/i).fill('Camry');
  await page.getByLabel(/year/i).fill('2020');
  
  await page.getByRole('button', { name: /save/i }).click();
  
  await expect(page.getByText('Toyota Camry')).toBeVisible();
});
```

## Code Style

### TypeScript

- Use TypeScript for all new code
- Enable strict mode
- Define interfaces for all data structures
- Use type inference where possible

### Formatting

```bash
# Backend (Biome)
cd backend
bun run format

# Frontend (Prettier)
cd frontend
npm run format
```

### Linting

```bash
# Backend
cd backend
bun run lint

# Frontend
cd frontend
npm run lint
npm run lint:fix
```

### Pre-commit Hooks

Husky is configured to run checks before commits:

```bash
# Install hooks
npm run prepare

# Hooks will run automatically on commit
git commit -m "your message"
```

## Debugging

### Backend Debugging

```bash
# Enable debug logging
LOG_LEVEL=debug bun run dev

# Use Bun debugger
bun --inspect src/index.ts
```

### Frontend Debugging

```bash
# SvelteKit debug mode
DEBUG=* npm run dev

# Browser DevTools
# Open browser console and use debugger
```

### Database Debugging

```bash
# Open SQLite database
sqlite3 backend/data/vroom.db

# Run queries
sqlite> SELECT * FROM vehicles;
sqlite> .schema vehicles
sqlite> .exit
```

## Contributing

### Before Contributing

1. Check [existing issues](https://github.com/your-username/vroom/issues)
2. Read [CONTRIBUTING.md](../CONTRIBUTING.md)
3. Discuss major changes in an issue first

### Pull Request Process

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Update documentation
6. Run all tests and linting
7. Commit with conventional commits
8. Push to your fork
9. Create a Pull Request

### PR Checklist

- [ ] Tests pass (`bun test` and `npm test`)
- [ ] E2E tests pass (`npm run test:e2e`)
- [ ] Linting passes (`npm run lint`)
- [ ] Code is formatted (`npm run format`)
- [ ] Documentation updated
- [ ] Commit messages follow convention
- [ ] PR description explains changes

### Code Review

- Be respectful and constructive
- Respond to feedback promptly
- Make requested changes
- Keep PRs focused and small

## Resources

### Documentation

- [SvelteKit Docs](https://kit.svelte.dev/docs)
- [Bun Docs](https://bun.sh/docs)
- [Drizzle ORM Docs](https://orm.drizzle.team/docs/overview)
- [Hono Docs](https://hono.dev/)
- [Lucia Auth Docs](https://lucia-auth.com/)
- [Playwright Docs](https://playwright.dev/)

### Tools

- [Svelte DevTools](https://github.com/sveltejs/svelte-devtools)
- [Drizzle Studio](https://orm.drizzle.team/drizzle-studio/overview)
- [Postman](https://www.postman.com/) - API testing
- [SQLite Browser](https://sqlitebrowser.org/) - Database viewer

### Community

- [GitHub Discussions](https://github.com/your-username/vroom/discussions)
- [GitHub Issues](https://github.com/your-username/vroom/issues)

## Getting Help

If you need help with development:

1. Check this guide and other documentation
2. Search existing issues and discussions
3. Ask in GitHub Discussions
4. Open an issue with the "question" label

Happy coding! 🚗💨
