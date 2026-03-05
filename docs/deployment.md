# Deployment Guide

Complete guide for deploying and self-hosting VROOM.

## System Requirements

- **CPU**: 1 core (2 recommended)
- **RAM**: 512MB (1GB recommended)
- **Storage**: 2GB + database growth
- **Docker**: 20.10+ with Compose v2+

## Quick Start (Docker Compose)

Example compose files and environment configuration are in [`docs/examples/`](examples/):

- `docker-compose.yml` — production compose with healthchecks, Cloudflare Tunnel
- `portainer-stack.yml` — simplified stack for Portainer deployment
- `.env.example` — environment variable template

```bash
git clone https://github.com/OnlyOneByte/vroom.git
cd vroom
cp docs/examples/docker-compose.yml docker-compose.yml
cp docs/examples/.env.example .env
# Edit .env with your configuration (see Environment Variables below)
docker-compose -f docker-compose.yml up -d
```

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:3001`
- Health check: `http://localhost:3001/health`

## Environment Variables

### Required

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL (e.g., `https://yourdomain.com/api/v1/auth/callback/google`) |
| `SESSION_SECRET` | Min 32 chars. Generate with `openssl rand -base64 32` |
| `FRONTEND_URL` | Frontend URL for OAuth redirects |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `PUBLIC_API_URL` | Backend URL as seen by the frontend |

### Optional

| Variable | Default | Description |
|---|---|---|
| `BACKEND_PORT` | `3001` | Backend port |
| `FRONTEND_PORT` | `3000` | Frontend port |
| `DATABASE_URL` | `/app/data/vroom.db` | SQLite database path |
| `LOG_LEVEL` | `warn` | `error`, `warn`, `info`, `debug` |
| `DATA_PATH` | `./data` | Host path for persistent data |
| `CLOUDFLARE_TUNNEL_TOKEN` | — | Cloudflare Tunnel token for HTTPS |

### Example Production `.env`

```env
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_secret
GOOGLE_REDIRECT_URI=https://yourdomain.com/api/v1/auth/callback/google
SESSION_SECRET=your_32_char_secret_here
FRONTEND_URL=https://yourdomain.com
CORS_ORIGINS=https://yourdomain.com
PUBLIC_API_URL=https://yourdomain.com
LOG_LEVEL=warn
DATA_PATH=/var/vroom/data
```

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create a project
2. Navigate to APIs & Services → Library, search under Google Enterprise API, and enable:
   - **Google Drive API** — required for backup and photo storage
   - **Google Sheets API** — required for Google Sheets mirroring/restore
3. Navigate to APIs & Services → OAuth consent screen → Data Access tab and add the following scopes:
   - `../auth/drive.file` — See, edit, create, and delete only the specific Google Drive files you use with this app
   - `../auth/drive.appdata` — See, create, and delete its own configuration data in your Google Drive
   - `../auth/drive.install` — Connect itself to your Google Drive
   - `../auth/spreadsheets` — See, edit, create, and delete all your Google Sheets spreadsheets (sensitive scope)
4. Navigate to APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID:
   - Application type: Web application
   - Authorized redirect URIs: `https://yourdomain.com/api/v1/auth/callback/google`
   - Copy Client ID → `GOOGLE_CLIENT_ID`
   - Copy Client Secret → `GOOGLE_CLIENT_SECRET`

All Drive and Sheets access is handled through the OAuth token — no separate API key is needed.

For personal self-hosting, the app will show an "unverified app" warning — click Advanced → Continue. This is normal for apps not submitted for Google verification.

### Optional: Branding & Verification

If you want to remove the "unverified app" warning or publish your instance for others, you'll need to configure branding and submit for Google verification.

1. Navigate to APIs & Services → OAuth consent screen → Branding tab:
   - App name: your app name (e.g., "VROOM")
   - User support email: your email address
   - App logo: upload a logo (optional, but required for verification)
   - App home page: `https://yourdomain.com`
   - App privacy policy link: `https://yourdomain.com/privacy`
   - App terms of service link: `https://yourdomain.com/terms`
   - Developer contact email: your email address
2. Under Audience, set User Type to External if you want anyone with a Google account to log in, or Internal if you're on a Google Workspace org and want to restrict to your org.
3. If you added sensitive scopes (like `spreadsheets`), Google requires verification before the "unverified app" warning is removed for external users. Submit for verification from the OAuth consent screen — this can take several days to weeks.

VROOM includes built-in `/privacypolicy` and `/termsofservice` pages that you can customize. They ship with reasonable defaults for a self-hosted open-source project. Edit them at:
- `frontend/src/routes/privacypolicy/+page.svelte`
- `frontend/src/routes/termsofservice/+page.svelte`

## Deployment Options

### Pre-built Images (Recommended)

The CI/CD pipeline publishes images to GitHub Container Registry on every push to `main`:

```bash
docker-compose -f docker-compose.yml up -d
```

Images: `ghcr.io/onlyonebyte/vroom/backend:latest` and `ghcr.io/onlyonebyte/vroom/frontend:latest`

### Build from Source

```bash
docker-compose -f docker-compose.yml build
docker-compose -f docker-compose.yml up -d
```

### Manual (No Docker)

```bash
# Backend
cd backend
bun install
bun run build
NODE_ENV=production bun run start

# Frontend
cd frontend
npm install
npm run build
node build
```

### Portainer Stack

A ready-to-use Portainer stack file is at [`docs/examples/portainer-stack.yml`](examples/portainer-stack.yml).

1. Open Portainer → Stacks → Add Stack
2. Paste the contents of `portainer-stack.yml` or upload it directly
3. Add the required environment variables (see [Environment Variables](#environment-variables))
4. Deploy the stack

The stack includes optional services for Cloudflare Tunnel and auto-updates (Tugtainer) — remove them if not needed.

## Reverse Proxy + SSL

### Caddy (Simplest)

```
yourdomain.com {
    handle /api/* {
        reverse_proxy localhost:3001
    }
    handle {
        reverse_proxy localhost:3000
    }
}
```

Caddy handles SSL automatically via Let's Encrypt.

### Nginx

```nginx
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

    location /api {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Cloudflare Tunnel (Recommended for Home Hosting)

Cloudflare Tunnel lets you expose your local VROOM instance to the internet without opening ports, configuring a static IP, or managing SSL certificates. Your home IP stays hidden. Tunnels are included on Cloudflare's free plan.

#### Prerequisites

- A domain (e.g., `myvroom.xyz`) added to Cloudflare with nameservers pointed to Cloudflare
- A free [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) account

#### 1. Create the Tunnel

1. Go to [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → Networks → Tunnels → Create a tunnel
2. Choose "Cloudflared" as the connector type
3. Name it (e.g., `vroom`)
4. Copy the tunnel token — this becomes your `CLOUDFLARE_TUNNEL_TOKEN` env var
5. Skip the connector install step — the Docker Compose `cloudflared` service handles this

#### 2. Configure Public Hostnames

Add two path-based routes so everything runs on a single domain. All backend routes (auth, API, sync) live under `/api/*`, so you only need two entries:

| Subdomain | Domain | Path | Service |
|---|---|---|---|
| *(empty)* | `myvroom.xyz` | `/api/*` | `http://backend:3001` |
| *(empty)* | `myvroom.xyz` | `/*` | `http://frontend:3000` |

Order matters — the `/api/*` route must come before the catch-all `/*`.

> **Why only two routes?** Auth callbacks go through `/api/v1/auth/callback/google`, which is already covered by the `/api/*` rule. The `/health` endpoint is only used by Docker's internal healthcheck (runs inside the container) and doesn't need external exposure. The `/auth` path in the browser is a SvelteKit client-side route, handled by the frontend catch-all.

> The service hostnames (`backend`, `frontend`) reference the Docker Compose service names. Cloudflared runs in the same Docker network and resolves them automatically.

#### 3. DNS

Cloudflare automatically creates a CNAME record for your domain pointing to the tunnel when you add the public hostname. You don't need to manually create DNS records. If you have existing A/AAAA records for the root domain, delete them to avoid conflicts.

#### 4. Environment Variables

```env
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoiYWJj...your_token_here
GOOGLE_REDIRECT_URI=https://myvroom.xyz/api/v1/auth/callback/google
FRONTEND_URL=https://myvroom.xyz
CORS_ORIGINS=https://myvroom.xyz
PUBLIC_API_URL=https://myvroom.xyz
```

#### 5. Deploy

```bash
docker-compose up -d
```

The `cloudflared` container establishes an outbound-only connection to Cloudflare's edge network. Cloudflare handles TLS termination, DDoS protection, and routing. No port forwarding, no firewall changes, no SSL cert management needed.

## Auto-Updates

Set up a cron job to automatically check for new images and restart containers:

```bash
# Create the update script
cat > /home/ubuntu/vroom-update.sh << 'EOF'
#!/bin/bash
cd /path/to/vroom
docker compose -f docs/examples/docker-compose.yml pull --quiet
docker compose -f docs/examples/docker-compose.yml up -d --remove-orphans
docker image prune -af --filter "until=168h"
EOF
chmod +x /home/ubuntu/vroom-update.sh

# Run hourly via cron
(crontab -l 2>/dev/null; echo "0 * * * * /home/ubuntu/vroom-update.sh >> /var/log/vroom-update.log 2>&1") | crontab -
```

The script pulls the latest images, restarts only containers with updated images, and cleans up old images older than 7 days.

## Database Management

### Backup

```bash
# Copy database from container
docker cp vroom-backend:/app/data/vroom.db ./backups/vroom-$(date +%Y%m%d).db

# Or if using bind mount
cp $DATA_PATH/vroom.db ./backups/vroom-$(date +%Y%m%d).db
```

VROOM also supports automatic backup to Google Drive (ZIP of CSVs) and Google Sheets mirroring — configure in Settings after login.

### Restore

```bash
docker-compose -f docker-compose.yml down
cp ./backups/vroom-backup.db $DATA_PATH/vroom.db
docker-compose -f docker-compose.yml up -d
```

Or restore from Google Sheets via Settings → Backup → Restore.

### Migrations

Migrations run automatically on server startup. To run manually:

```bash
docker-compose -f docker-compose.yml exec backend bun run db:push
```

## Hosting Platforms

| Platform | Cost | Notes |
|---|---|---|
| Home lab / Raspberry Pi 4 | Free | Full control, need to manage networking |
| VPS (DigitalOcean, Linode, Vultr, Hetzner) | $5–10/mo | Reliable, easy remote access |
| [Oracle Cloud Free Tier](oci/README.md) | Free forever | ARM VM with 4 OCPUs + 24GB RAM, 200GB storage — [full guide](oci/README.md) |
| Synology/QNAP NAS | Free (existing hardware) | Docker via Package Center |

## Maintenance

### Health Checks

```bash
docker-compose -f docker-compose.yml ps
curl http://localhost:3001/health
docker stats vroom-backend vroom-frontend
```

### Logs

```bash
docker-compose -f docker-compose.yml logs -f backend
docker-compose -f docker-compose.yml logs --tail=100 frontend
```

### Updates

```bash
docker-compose -f docker-compose.yml pull
docker-compose -f docker-compose.yml up -d
docker image prune -a  # clean old images
```

## Security Checklist

- [ ] HTTPS enabled (Caddy, Nginx + Let's Encrypt, or Cloudflare Tunnel)
- [ ] Strong `SESSION_SECRET` (32+ random chars)
- [ ] `CORS_ORIGINS` restricted to your domain only
- [ ] Firewall: only ports 80/443 exposed (22 for SSH)
- [ ] Docker images kept up to date
- [ ] Database backups enabled (Google Drive or manual)
