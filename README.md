# VROOM

[![CI/CD](https://github.com/OnlyOneByte/VROOM/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/OnlyOneByte/VROOM/actions/workflows/ci-cd.yml)
![Frontend Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/OnlyOneByte/VROOM/coverage-badges/frontend-coverage.json)
![Backend Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/OnlyOneByte/VROOM/coverage-badges/backend-coverage.json)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20VROOM-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/onemorebyte)

VROOM (Vehicle Record & Organization Of Maintenance) is a self-hostable car cost tracking app with mobile-first design, comprehensive expense analytics, and Google Drive backup.

> ⚠️ **Under active development.** Features, APIs, and database schemas may change between releases. Back up your data regularly via Google Drive sync. Pin to a specific image tag rather than `latest` for stability.

> 🤖 **AI-native development.** Much of the code is written with AI assistance. All architecture decisions, feature direction, and code review are done by a human developer.

## Why VROOM?

- **Open Source** — fork, customize, and host it yourself with full control over your data
- **Open Format** — data stored in standard CSV format via Google Drive backup, zero lock-in
- **Google Drive Integration** — your data syncs directly to your Google Drive
- **Privacy First** — no third-party data storage; everything lives on your server and your Drive

## Features

- 📱 Mobile-first PWA with offline support
- 🚗 Multi-vehicle tracking (gas, electric, hybrid)
- 📊 Interactive analytics and cost visualization
- ⛽ Fuel efficiency tracking with fill-up history
- 💰 Financing and insurance management
- � Pohoto attachments for receipts and documents
- 🔐 OAuth authentication (Google, GitHub)
- 💾 Google Drive backup + Google Sheets sync
- 🐳 Docker-ready self-hosting

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | SvelteKit, Svelte 5 (runes), Tailwind CSS v4, shadcn-svelte, layerchart, Zod, Vitest + Playwright |
| Backend | Hono on Bun, Drizzle ORM + SQLite, Lucia Auth, Biome |
| Infra | Docker, GitHub Actions CI/CD, GitHub Container Registry |

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) (backend runtime)
- Node.js 22+ (frontend — see `.nvmrc`)
- Docker 20.10+ (optional, for containerized deployment)

### Local Development

```bash
nvm use

# Backend
cd backend
bun install
cp .env.example .env   # configure OAuth credentials
bun run db:push
bun run dev             # http://localhost:3001

# Frontend (separate terminal)
cd frontend
npm install
cp .env.example .env    # set PUBLIC_API_URL=http://localhost:3001
npm run dev             # http://localhost:5173
```

### Docker (Production)

```bash
cp docs/examples/.env.example .env
cp docs/examples/docker-compose.yml .
docker-compose up -d
# Frontend: http://localhost:3000
# Backend:  http://localhost:3001
```

See the [Deployment Guide](docs/deployment.md) for full instructions.

## Project Structure

```
vroom/
├── backend/              # Bun + Hono API server
│   ├── src/
│   │   ├── api/          # Domain modules (auth, vehicles, expenses, financing, insurance, photos, analytics, sync)
│   │   ├── db/           # Schema, connection, migrations, seeding
│   │   ├── middleware/    # Auth, rate-limit, error-handler, idempotency, body-limit, activity
│   │   └── utils/        # Calculations, logger, validation, unit-conversions
│   └── drizzle/          # SQL migrations
├── frontend/             # SvelteKit PWA
│   ├── src/
│   │   ├── lib/
│   │   │   ├── components/   # Domain components + shadcn-svelte ui/
│   │   │   ├── services/     # API client + domain services
│   │   │   ├── stores/       # Svelte stores (app, auth, offline, settings)
│   │   │   ├── types/        # TypeScript types
│   │   │   ├── utils/        # Shared utilities
│   │   │   ├── constants/    # App constants
│   │   │   └── hooks/        # Svelte 5 reactive hooks
│   │   └── routes/           # SvelteKit file-based routing
│   └── e2e/                  # Playwright E2E tests
├── docs/                 # Documentation
│   └── examples/         # Docker Compose, Portainer stack, .env template
└── .github/workflows/    # CI/CD pipeline
```

## Documentation

| Document | Description |
|---|---|
| [Architecture](docs/architecture.md) | System design, data flow, and module responsibilities |
| [Development Guide](docs/development.md) | Local setup, workflow, testing, and code style |
| [Deployment Guide](docs/deployment.md) | Docker, self-hosting, reverse proxy, and SSL |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and solutions |

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Follow [conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, etc.)
4. Run validation before pushing:
   - Backend: `bun run all:fix && bun run validate`
   - Frontend: `npm run all:fix && npm run validate`
5. Open a pull request

## Support

If VROOM is useful to you, consider buying me a coffee:

[![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/onemorebyte)

## License

AGPL-3.0 — see [LICENSE](LICENSE) for details.
