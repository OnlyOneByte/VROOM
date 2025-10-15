# VROOM Car Tracker - Deployment Guide

This guide covers deploying VROOM Car Tracker using Docker and Docker Compose for both development and production environments.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start (Development)](#quick-start-development)
- [Production Deployment](#production-deployment)
- [Portainer Integration](#portainer-integration)
- [Environment Configuration](#environment-configuration)
- [Database Management](#database-management)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Software

- **Docker**: Version 20.10 or higher
- **Docker Compose**: Version 2.0 or higher
- **Git**: For cloning the repository

### Installation

#### Linux
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt-get update
sudo apt-get install docker-compose-plugin

# Add your user to docker group
sudo usermod -aG docker $USER
newgrp docker
```

#### macOS
```bash
# Install Docker Desktop
brew install --cask docker
```

#### Windows
Download and install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/)

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API
4. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"
5. Configure the OAuth consent screen
6. Create OAuth 2.0 credentials:
   - Application type: Web application
   - Authorized redirect URIs: `http://localhost:3001/auth/callback/google` (development)
7. Save the Client ID and Client Secret

## Quick Start (Development)

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/vroom.git
cd vroom
```

### 2. Configure Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your configuration
nano .env  # or use your preferred editor
```

**Minimum required configuration:**
```env
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
SESSION_SECRET=$(openssl rand -base64 32)
```

### 3. Start Development Environment

```bash
# Start all services with hot reload
docker-compose up

# Or run in detached mode
docker-compose up -d

# View logs
docker-compose logs -f
```

### 4. Access the Application

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3001
- **Health Check**: http://localhost:3001/health

### 5. Stop Development Environment

```bash
# Stop services
docker-compose down

# Stop and remove volumes (WARNING: deletes database)
docker-compose down -v
```

## Production Deployment

### Option 1: Using Pre-built Images (Recommended)

#### 1. Pull Images from GitHub Container Registry

```bash
# Login to GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Pull latest images
docker pull ghcr.io/your-username/vroom/backend:latest
docker pull ghcr.io/your-username/vroom/frontend:latest
```

#### 2. Configure Production Environment

```bash
# Copy and configure production environment
cp .env.example .env
nano .env
```

**Production configuration example:**
```env
GITHUB_REPOSITORY=your-username/vroom
BACKEND_PORT=3001
FRONTEND_PORT=3000

GOOGLE_CLIENT_ID=your_production_client_id
GOOGLE_CLIENT_SECRET=your_production_client_secret
GOOGLE_REDIRECT_URI=https://yourdomain.com/auth/callback/google
SESSION_SECRET=your_production_session_secret

CORS_ORIGINS=https://yourdomain.com
PUBLIC_API_URL=https://api.yourdomain.com
LOG_LEVEL=warn

DATA_PATH=/var/vroom/data
```

#### 3. Start Production Services

```bash
# Start production stack
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Check service status
docker-compose -f docker-compose.prod.yml ps
```

#### 4. Enable Auto-Updates (Optional)

```bash
# Start with Watchtower for automatic updates
docker-compose -f docker-compose.prod.yml --profile auto-update up -d
```

### Option 2: Building from Source

```bash
# Build images locally
docker-compose -f docker-compose.prod.yml build

# Start services
docker-compose -f docker-compose.prod.yml up -d
```

## Portainer Integration

Portainer provides a web-based UI for managing Docker containers.

### Install Portainer

```bash
# Create Portainer volume
docker volume create portainer_data

# Run Portainer
docker run -d \
  -p 9000:9000 \
  -p 9443:9443 \
  --name portainer \
  --restart=always \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v portainer_data:/data \
  portainer/portainer-ce:latest
```

### Access Portainer

1. Open http://localhost:9000 or https://localhost:9443
2. Create an admin account
3. Connect to local Docker environment

### Deploy VROOM via Portainer

#### Method 1: Using Stacks

1. Go to **Stacks** → **Add Stack**
2. Name: `vroom-production`
3. Upload `docker-compose.prod.yml`
4. Add environment variables from `.env`
5. Click **Deploy the stack**

#### Method 2: Using Git Repository

1. Go to **Stacks** → **Add Stack**
2. Select **Git Repository**
3. Repository URL: `https://github.com/your-username/vroom`
4. Compose path: `docker-compose.prod.yml`
5. Add environment variables
6. Enable **Automatic updates** (optional)
7. Click **Deploy the stack**

### Managing VROOM in Portainer

- **View Logs**: Stacks → vroom-production → Logs
- **Restart Services**: Stacks → vroom-production → Restart
- **Update Images**: Stacks → vroom-production → Pull and redeploy
- **Monitor Resources**: Containers → Select container → Stats

## Environment Configuration

### Backend Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `production` | Environment mode |
| `PORT` | No | `3001` | Backend port |
| `HOST` | No | `0.0.0.0` | Backend host |
| `DATABASE_URL` | No | `/app/data/vroom.db` | SQLite database path |
| `GOOGLE_CLIENT_ID` | Yes | - | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | - | Google OAuth Client Secret |
| `GOOGLE_REDIRECT_URI` | Yes | - | OAuth redirect URI |
| `SESSION_SECRET` | Yes | - | Session encryption secret |
| `GOOGLE_DRIVE_API_KEY` | No | - | Google Drive API key |
| `CORS_ORIGINS` | No | - | Allowed CORS origins |
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Rate limit window (ms) |
| `RATE_LIMIT_MAX_REQUESTS` | No | `100` | Max requests per window |
| `LOG_LEVEL` | No | `warn` | Logging level |

### Frontend Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `production` | Environment mode |
| `PORT` | No | `3000` | Frontend port |
| `HOST` | No | `0.0.0.0` | Frontend host |
| `PUBLIC_API_URL` | Yes | - | Backend API URL |

### Generating Secrets

```bash
# Generate session secret
openssl rand -base64 32

# Generate multiple secrets at once
for i in {1..3}; do openssl rand -base64 32; done
```

## Database Management

### Backup Database

```bash
# Backup SQLite database
docker-compose -f docker-compose.prod.yml exec backend \
  cp /app/data/vroom.db /app/data/vroom-backup-$(date +%Y%m%d).db

# Copy backup to host
docker cp vroom-backend:/app/data/vroom-backup-$(date +%Y%m%d).db ./backups/
```

### Restore Database

```bash
# Copy backup to container
docker cp ./backups/vroom-backup.db vroom-backend:/app/data/vroom.db

# Restart backend
docker-compose -f docker-compose.prod.yml restart backend
```

### Initialize Database

```bash
# Run database initialization
docker-compose -f docker-compose.prod.yml exec backend bun run db:init

# Run with seed data
docker-compose -f docker-compose.prod.yml exec backend bun run db:seed
```

### Database Migrations

```bash
# Generate new migration
docker-compose -f docker-compose.prod.yml exec backend bun run db:generate

# Apply migrations
docker-compose -f docker-compose.prod.yml exec backend bun run db:push
```

## Reverse Proxy Setup

### Nginx Configuration

```nginx
# /etc/nginx/sites-available/vroom
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Auth endpoints
    location /auth {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Traefik Configuration

```yaml
# docker-compose.traefik.yml
version: '3.8'

services:
  traefik:
    image: traefik:v2.10
    command:
      - "--api.insecure=true"
      - "--providers.docker=true"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.email=your@email.com"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
    ports:
      - "80:80"
      - "443:443"
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./letsencrypt:/letsencrypt
    networks:
      - vroom-network

  backend:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.backend.rule=Host(`yourdomain.com`) && PathPrefix(`/api`, `/auth`)"
      - "traefik.http.routers.backend.entrypoints=websecure"
      - "traefik.http.routers.backend.tls.certresolver=letsencrypt"

  frontend:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.frontend.rule=Host(`yourdomain.com`)"
      - "traefik.http.routers.frontend.entrypoints=websecure"
      - "traefik.http.routers.frontend.tls.certresolver=letsencrypt"
```

## Monitoring and Logs

### View Logs

```bash
# All services
docker-compose -f docker-compose.prod.yml logs -f

# Specific service
docker-compose -f docker-compose.prod.yml logs -f backend

# Last 100 lines
docker-compose -f docker-compose.prod.yml logs --tail=100 backend
```

### Health Checks

```bash
# Backend health
curl http://localhost:3001/health

# Frontend health
curl http://localhost:3000/

# Check container health status
docker-compose -f docker-compose.prod.yml ps
```

### Resource Usage

```bash
# Container stats
docker stats vroom-backend vroom-frontend

# Disk usage
docker system df
```

## Troubleshooting

### Common Issues

#### 1. Port Already in Use

```bash
# Find process using port
sudo lsof -i :3001

# Kill process
sudo kill -9 <PID>
```

#### 2. Permission Denied

```bash
# Fix data directory permissions
sudo chown -R $USER:$USER ./data

# Fix Docker socket permissions
sudo chmod 666 /var/run/docker.sock
```

#### 3. Database Locked

```bash
# Stop all services
docker-compose -f docker-compose.prod.yml down

# Remove lock files
rm -f ./data/*.db-shm ./data/*.db-wal

# Restart services
docker-compose -f docker-compose.prod.yml up -d
```

#### 4. OAuth Redirect Mismatch

Ensure `GOOGLE_REDIRECT_URI` matches exactly what's configured in Google Cloud Console:
- Development: `http://localhost:3001/auth/callback/google`
- Production: `https://yourdomain.com/auth/callback/google`

#### 5. CORS Errors

Update `CORS_ORIGINS` to include your frontend URL:
```env
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

### Debug Mode

```bash
# Enable debug logging
docker-compose -f docker-compose.prod.yml exec backend \
  sh -c 'export LOG_LEVEL=debug && bun run start'

# Check environment variables
docker-compose -f docker-compose.prod.yml exec backend env
```

### Reset Everything

```bash
# Stop and remove everything
docker-compose -f docker-compose.prod.yml down -v

# Remove images
docker rmi ghcr.io/your-username/vroom/backend:latest
docker rmi ghcr.io/your-username/vroom/frontend:latest

# Clean Docker system
docker system prune -a --volumes
```

## Updating VROOM

### Manual Update

```bash
# Pull latest images
docker-compose -f docker-compose.prod.yml pull

# Restart services
docker-compose -f docker-compose.prod.yml up -d
```

### Automatic Updates with Watchtower

Watchtower is included in the production compose file:

```bash
# Enable auto-updates
docker-compose -f docker-compose.prod.yml --profile auto-update up -d
```

Watchtower will check for updates every hour and automatically update containers.

## Security Best Practices

1. **Use Strong Secrets**: Generate secure random strings for `SESSION_SECRET`
2. **Enable HTTPS**: Use a reverse proxy with SSL/TLS certificates
3. **Restrict CORS**: Only allow trusted origins in `CORS_ORIGINS`
4. **Regular Backups**: Automate database backups
5. **Update Regularly**: Keep Docker images and dependencies up to date
6. **Monitor Logs**: Regularly check logs for suspicious activity
7. **Firewall Rules**: Restrict access to Docker ports
8. **Non-root User**: Containers run as non-root users by default

## Support

For issues and questions:
- GitHub Issues: https://github.com/your-username/vroom/issues
- Documentation: https://github.com/your-username/vroom/wiki

## License

See [LICENSE](LICENSE) file for details.
