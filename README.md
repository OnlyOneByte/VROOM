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
- 📷 Photo attachments for receipts and documents
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
- Node.js 22.22.2+ (frontend) — the lockfile needs `^22.22.2 || ^24.15.0 || >=26.0.0`;
  `npm ci` fails with `EBADENGINE` on anything older. `nvm use` reads `.nvmrc`
- Docker 20.10+ with Compose v2 (optional, for containerized deployment)

### Local Development

```bash
nvm use

# Backend
cd backend
bun install
cp .env.example .env   # configure OAuth credentials
bun run db:init         # apply migrations (add --seed for sample data)
bun run dev             # http://localhost:3001

# Frontend (separate terminal)
cd frontend
npm ci                  # not `npm install` — see the Development Guide
npm run dev             # http://localhost:5173, proxies /api to :3001
```

### Docker (Production)

```bash
cp docs/examples/.env.example .env
cp docs/examples/docker-compose.yml .
mkdir -p data                                  # the DATA_PATH bind mount; Docker won't create it
docker compose up -d
# Frontend: http://localhost:3000
# Backend:  http://localhost:3001
```

See the [Deployment Guide](docs/deployment.md) for full instructions.

## Project Structure

```
vroom/
├── backend/        # Bun + Hono API. One folder per domain under src/api/: routes.ts
│                   # plus any *repository.ts it needs. Migrations in drizzle/.
├── frontend/       # SvelteKit PWA. Components, services, stores, and utils
│                   # under src/lib/; file-based routing under src/routes/.
├── docs/           # Architecture, development, and deployment guides
│   └── examples/   # Docker Compose, Portainer stack, .env template
└── .github/        # CI/CD pipeline
```

## Documentation

| Document | Description |
|---|---|
| [Architecture](docs/architecture.md) | System design, data flow, and the reasoning behind it |
| [Development Guide](docs/development.md) | Local setup, workflow, and testing |
| [Deployment Guide](docs/deployment.md) | Docker, self-hosting, reverse proxy, and SSL |

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
