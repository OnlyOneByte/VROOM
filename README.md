# VROOM Car Tracker

VROOM (Vehicle Record & Organization Of Maintenance) 

A modern, self-hostable car cost tracking and visualization web application with mobile-first design and comprehensive expense analytics.

Note: This project is currently under active development and not ready for use.

## Project Structure

```
VROOM/
├── backend/                 # Bun + Hono API Server
│   ├── src/
│   │   ├── db/             # Database schemas and migrations
│   │   ├── lib/            # Utilities and repositories
│   │   ├── routes/         # API route handlers
│   │   ├── types/          # TypeScript type definitions
│   │   └── index.ts        # Server entry point
│   ├── package.json        # Backend dependencies
│   ├── tsconfig.json       # TypeScript configuration
│   └── drizzle.config.ts   # Database configuration
├── frontend/               # SvelteKit PWA Frontend
│   ├── src/
│   │   ├── lib/            # Shared utilities and stores
│   │   ├── routes/         # SvelteKit pages and layouts
│   │   ├── app.html        # HTML template
│   │   └── app.css         # Global styles
│   ├── package.json        # Frontend dependencies
│   ├── svelte.config.js    # SvelteKit configuration
│   ├── vite.config.ts      # Vite configuration
│   └── tailwind.config.js  # Tailwind CSS configuration
└── .kiro/specs/            # Feature specifications
    └── vroom-car-tracker/
        ├── requirements.md # Feature requirements
        ├── design.md      # Technical design
        └── tasks.md       # Implementation tasks
```

## Technology Stack

### Backend
- **Bun** - Fast JavaScript runtime and package manager
- **Hono** - Ultra-fast web framework
- **Drizzle ORM** - Type-safe database operations
- **SQLite** - Lightweight, serverless database
- **Lucia Auth** - Modern authentication library
- **TypeScript** - Type safety and developer experience

### Frontend
- **SvelteKit** - Full-stack web framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Utility-first CSS framework
- **D3.js** - Data visualization
- **Vite** - Fast build tool and dev server
- **PWA** - Progressive Web App capabilities

## Getting Started

### Prerequisites
- [Bun](https://bun.sh/) - JavaScript runtime and package manager
- Node.js 18+ (for SvelteKit)

### Installation

1. **Use the correct Node.js version**
   ```bash
   nvm use
   ```

2. **Install Backend Dependencies**
   ```bash
   cd backend
   npm install
   ```

3. **Install Frontend Dependencies**
   ```bash
   cd frontend
   npm install
   ```

4. **Environment Setup**
   ```bash
   # Backend
   cp backend/.env.example backend/.env
   # Edit backend/.env with your configuration
   
   # Frontend
   cp frontend/.env.example frontend/.env
   # Edit frontend/.env with your configuration
   ```

### Development

1. **Start Backend Server**
   ```bash
   cd backend
   bun run dev
   ```

2. **Start Frontend Development Server**
   ```bash
   cd frontend
   npm run dev
   ```

3. **Access the Application**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3001
   - Health Check: http://localhost:3001/health

## Features (Planned)

- 📱 **Mobile-First Design** - Optimized for mobile expense entry
- 🚗 **Multi-Vehicle Support** - Track expenses for multiple cars
- 📊 **Analytics & Visualization** - Interactive charts and cost analysis
- 🔐 **Secure Authentication** - Google OAuth integration
- 💾 **Flexible Storage** - SQLite + Google Sheets backup
- 📤 **Data Export** - Multiple format support (JSON, CSV, Excel)
- 🔄 **PWA Support** - Offline functionality and app-like experience
- 🐳 **Docker Ready** - Easy self-hosting with Docker
- 📈 **Fuel Efficiency Tracking** - MPG monitoring and alerts

## Documentation

### For Users
- **[Self-Hosting Guide](docs/SELF_HOSTING_GUIDE.md)** - Complete guide for self-hosting VROOM
- **[Deployment Guide](DEPLOYMENT.md)** - Docker deployment and production setup
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** - Common issues and solutions

### For Developers
- **[Development Guide](docs/DEVELOPMENT.md)** - Setting up development environment
- **[API Documentation](docs/API.md)** - Backend API reference (coming soon)
- **[Contributing Guide](CONTRIBUTING.md)** - How to contribute (coming soon)

## Quick Start

### Using Docker (Recommended)

```bash
# Clone repository
git clone https://github.com/OnlyOneByte/vroom.git
cd vroom

# Configure environment
cp .env.example .env
nano .env  # Add your Google OAuth credentials

# Start services
docker-compose -f docker-compose.prod.yml up -d

# Access application
open http://localhost:3000
```

See [Deployment Guide](DEPLOYMENT.md) for detailed instructions.

### Manual Installation

See [Development Guide](docs/DEVELOPMENT.md) for manual setup instructions.

## Testing

### Backend Tests
```bash
cd backend
bun test
```

### Frontend Unit Tests
```bash
cd frontend
npm test
```

### E2E Tests
```bash
cd frontend
npm run test:e2e
```

See [Development Guide](docs/DEVELOPMENT.md#testing) for more testing options.

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) before submitting PRs.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## Support

- **Issues**: [GitHub Issues](https://github.com/your-username/vroom/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-username/vroom/discussions)
- **Documentation**: [Wiki](https://github.com/your-username/vroom/wiki)

## License

MIT License - see [LICENSE](LICENSE) file for details.