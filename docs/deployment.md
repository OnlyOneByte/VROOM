# Deployment Guide

Self-hosting VROOM with Docker.

## Requirements

- Docker 20.10+ with Compose v2
- 1 CPU core, 512MB RAM, 2GB disk plus database growth
- HTTPS. The session cookie is set `Secure` when `NODE_ENV=production`, so login does not
  work over plain HTTP in a production container.

## Quick Start

```bash
git clone https://github.com/OnlyOneByte/VROOM.git
cd VROOM
cp docs/examples/docker-compose.yml docker-compose.yml
cp docs/examples/.env.example .env
# fill in .env — at minimum the two Google OAuth values and PROVIDER_ENCRYPTION_KEY,
# whose placeholder is deliberately invalid so an unedited copy fails loudly
mkdir -p data          # the bind-mounted DATA_PATH must exist before first start
docker compose up -d
```

Keep the compose file and `.env` in the same directory: Compose reads `.env` from the
compose file's directory, not from your shell's. Running `-f docs/examples/docker-compose.yml`
from the repo root looks for `docs/examples/.env` and silently starts with every variable
empty.

A container sees only what the stack's `environment:` block passes through, so a variable
added to `.env` and not to that block never reaches the backend.

Delete the `cloudflared` service unless you are using a tunnel — with an empty
`CLOUDFLARE_TUNNEL_TOKEN` it exits on start and is restarted forever.

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:3001`
- Health: `http://localhost:3001/health`

Examples in [`docs/examples/`](examples/):

| File | Contents |
|---|---|
| `docker-compose.yml` | backend, frontend, Cloudflare Tunnel; healthchecks; `DATA_PATH` bind mount |
| `portainer-stack.yml` | the same three plus Tugtainer (auto-updater); named volume, no `DATA_PATH` |
| `.env.example` | variable template |

## Environment Variables

`backend/src/config.ts` is the authoritative list.

The example stacks pass through only the variables in their backend `environment:` block. An
optional variable from the tables below (GitHub login, web push, `TRUSTED_PROXY_IPS`) takes effect
only after you add it to that block as well as to `.env`.

### Required in production

The backend logs the missing names and exits at startup without these.

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret |
| `PROVIDER_ENCRYPTION_KEY` | Exactly 64 hex chars. `openssl rand -hex 32` |

`PROVIDER_ENCRYPTION_KEY` is the AES-256-GCM key for stored provider credentials (Drive/Sheets
refresh tokens, S3 keys, LLM keys). Back it up with the database — if it changes, those
credentials no longer decrypt and every provider must be reconnected. Both example stacks pass
it through and `docs/examples/.env.example` carries a placeholder that fails the format check,
so an unedited copy exits with the variable named instead of encrypting with a published key.

There is no session secret: sessions are opaque ids in the database, so nothing is signed with
a configurable key. A `SESSION_SECRET` left over in an older `.env` is ignored.

### Needed for any real deployment

These have defaults, but the defaults only suit localhost.

| Variable | Default | Description |
|---|---|---|
| `GOOGLE_REDIRECT_URI` | `http://localhost:3001/api/v1/auth/callback/google` | Login callback. Set it to `https://yourdomain.com/api/v1/auth/callback/google`. The `/api/v1/auth` prefix is mandatory: a bare `/auth/...` path 404s after consent, because the `/api/*` → `/api/v1/*` compatibility redirect never sees it |
| `FRONTEND_URL` | `https://your-domain.com` in production | Where the backend redirects after login |
| `CORS_ORIGINS` | `https://your-domain.com` in production | Comma-separated browser origins. Doubles as the CSRF origin allowlist, so a wrong value makes every POST/PUT/DELETE fail |
| `PUBLIC_API_URL` | empty | Backend URL as the browser sees it. Empty means same-origin, which is correct behind a single-domain proxy or tunnel. Set it only when frontend and backend are on different origins (e.g. `http://localhost:3001` for the port-mapped quick start) |

### Optional

| Variable | Default | Description |
|---|---|---|
| `BACKEND_PORT` | `3001` | Host port in the example stacks |
| `FRONTEND_PORT` | `3000` | Host port in the example stacks |
| `ORIGIN` | unset (derived from the request) | Frontend container only. The public origin the server reports, e.g. `https://yourdomain.com`, instead of deriving it from the request headers. Read at startup, so a change needs a container restart, not a rebuild. Leave it unset unless header-derived origins are wrong behind your proxy; an empty value stops the frontend from starting |
| `HOST` | `127.0.0.1` | Address the backend binds. The default is loopback only, so a direct install is not exposed until you say so; containers need `0.0.0.0` (both Dockerfiles and example stacks set it). The backend exits naming `HOST` if this machine has no such address |
| `DATABASE_URL` | `./data/vroom.db` | SQLite file. Both Dockerfiles and example stacks set `/app/data/vroom.db` |
| `DATA_PATH` | `./data` | Host directory bind-mounted at `/app/data` by `docker-compose.yml`. Must exist |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug` |
| `TRUSTED_PROXY_IPS` | empty | Comma-separated proxy IPs whose `X-Forwarded-For` is honored. Left unset behind a reverse proxy, every anonymous request shares one rate-limit bucket keyed on the proxy's IP |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | — | Set both to add a GitHub login button. Callback defaults to `http://localhost:3001/api/v1/auth/callback/github`; override with `GITHUB_REDIRECT_URI` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | — | Web push. All three or the feature stays off. Generate with `bun run vapid:gen` |
| `GOOGLE_PROVIDER_REDIRECT_URI` | derived from `GOOGLE_REDIRECT_URI` | Storage-connect callback. Override only if it must differ from the derived `.../callback/provider/google` |
| `CLOUDFLARE_TUNNEL_TOKEN` | — | Read by the `cloudflared` service in the example stacks |

### Example production `.env`

```env
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_secret
GOOGLE_REDIRECT_URI=https://yourdomain.com/api/v1/auth/callback/google
PROVIDER_ENCRYPTION_KEY=64_hex_chars_from_openssl_rand_hex_32
FRONTEND_URL=https://yourdomain.com
CORS_ORIGINS=https://yourdomain.com
LOG_LEVEL=warn
DATA_PATH=/var/vroom/data
```

`PUBLIC_API_URL` is omitted on purpose — the frontend then calls the backend same-origin
through the proxy.

## Google OAuth Setup

1. [Google Cloud Console](https://console.cloud.google.com/) → create a project.
2. APIs & Services → Library → enable:
   - **Google Drive API** — backup and photo storage
   - **Google Sheets API** — Sheets mirroring and restore
   - **Photos Library API** — reading back receipt photos VROOM uploaded
3. APIs & Services → OAuth consent screen → Data Access → add the scopes VROOM requests:
   - `openid`, `../auth/userinfo.email`, `../auth/userinfo.profile` — login
   - `../auth/drive.file` — only the Drive files VROOM creates
   - `../auth/photoslibrary.readonly.appcreateddata` — only the photos VROOM uploaded
4. APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID, type
   Web application, with **both** authorized redirect URIs:
   - `https://yourdomain.com/api/v1/auth/callback/google` — login
   - `https://yourdomain.com/api/v1/auth/callback/provider/google` — connecting Drive,
     Sheets, or Photos. The backend derives this from `GOOGLE_REDIRECT_URI`; omitting it
     from the console breaks provider connection with `redirect_uri_mismatch`.

   Copy the Client ID and Secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

Drive, Sheets, and Photos all go through the user's OAuth token — no API key is used.

A personal instance that has not been submitted for Google verification shows an
"unverified app" warning; click Advanced → Continue. To remove it, fill in the OAuth consent
screen Branding tab (app name, support email, logo, home page, privacy policy, terms,
developer contact), set the Audience, and submit for verification. VROOM ships customizable
`/privacypolicy` and `/termsofservice` pages at
`frontend/src/routes/{privacypolicy,termsofservice}/+page.svelte`.

## Deployment Options

### Pre-built images (recommended)

`ghcr.io/onlyonebyte/vroom/backend` and `ghcr.io/onlyonebyte/vroom/frontend`.

| Tag | Published on |
|---|---|
| `latest`, `X.Y.Z`, `X.Y` | a GitHub release |
| `dev`, `main`, `main-<sha>` | every push to `main` |
| `develop`, `develop-<sha>` | every push to `develop` |

Both example stacks pin `:latest`, i.e. the newest release. Switch them to `:dev` to track
`main`.

### Build from source

```bash
docker compose build
docker compose up -d
```

### Without Docker

```bash
cd backend  && bun install && bun run build && NODE_ENV=production bun run start
cd frontend && npm ci && npm run build && node build
```

Both read their configuration from the environment; the backend applies migrations on
startup. The backend binds `127.0.0.1` unless `HOST` says otherwise — right for a reverse
proxy on the same machine; set `HOST=0.0.0.0` to accept connections from other hosts.

### Portainer

Paste [`docs/examples/portainer-stack.yml`](examples/portainer-stack.yml) into Portainer →
Stacks → Add Stack, add the environment variables above, and deploy. Then configure the
tunnel hostnames (see [Cloudflare Tunnel](#cloudflare-tunnel)). The `cloudflared` and
`tugtainer` services are optional — delete them if unwanted.

## Reverse Proxy + SSL

Every backend route lives under `/api`. `/health` is only used by the container healthcheck
and needs no external exposure. So: `/api/*` to port 3001, everything else to port 3000.

Do not route `/auth/*` to the backend: `/auth` and `/auth/callback` are frontend pages.

Set `CORS_ORIGINS` and `FRONTEND_URL` to the public origin, leave `PUBLIC_API_URL` empty, and
set `TRUSTED_PROXY_IPS` to the proxy's address so rate limiting keys on the real client IP.

Upstreams below use `127.0.0.1` rather than `localhost`: the backend binds one loopback
address (`HOST`, `127.0.0.1` by default), while `localhost` resolves to both families and
which one a proxy dials first depends on the host's resolver.

### Caddy

```
yourdomain.com {
    handle /api/* {
        reverse_proxy 127.0.0.1:3001
    }
    handle {
        reverse_proxy 127.0.0.1:3000
    }
}
```

Caddy provisions SSL automatically via Let's Encrypt. It caps request bodies only when you
ask it to (`request_body max_size`), so backups and photo uploads need nothing extra here —
unlike nginx below.

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

    client_max_body_size 10m;  # the app caps request bodies at 10MB; nginx defaults to 1MB

    # Restoring a backup uploads a whole ZIP, which the app allows up to 50MB. nginx rejects
    # on Content-Length before the request ever reaches the backend, so this one path needs
    # its own larger cap — raising the server-wide value instead would widen the DoS surface
    # of every other route. The regex covers the unversioned alias, which 308-redirects here.
    location ~ ^/api/(v1/)?sync/restore/from-backup$ {
        client_max_body_size 50m;
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Regex locations are matched before prefix ones, so the restore block wins over `location /api`.
Without the 10MB `client_max_body_size`, photo and receipt uploads fail at the proxy with 413;
without the restore block, so does every backup larger than 10MB — the one path that must never
be blocked by a limit tuned for JSON payloads.

### Cloudflare Tunnel

Exposes a home instance without open ports, a static IP, or certificate management, on
Cloudflare's free plan. You need a domain on Cloudflare and a free
[Zero Trust](https://one.dash.cloudflare.com/) account.

1. Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared. Copy the token into
   `CLOUDFLARE_TUNNEL_TOKEN`; skip the connector install, the `cloudflared` service in the
   example stacks is the connector.
2. Add two public hostnames, `/api/*` first so it matches before the catch-all:

   | Subdomain | Domain | Path | Service |
   |---|---|---|---|
   | *(empty)* | `myvroom.xyz` | `/api/*` | `http://vroom-backend:3001` |
   | *(empty)* | `myvroom.xyz` | `/*` | `http://vroom-frontend:3000` |

   Use the container names, not `localhost` — `cloudflared` runs in its own container and
   resolves the others over the shared `vroom-network` bridge.
3. Cloudflare creates the CNAME itself. Delete any existing A/AAAA records on that name.
4. Point the environment at the public origin:

   ```env
   CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoiYWJj...
   GOOGLE_REDIRECT_URI=https://myvroom.xyz/api/v1/auth/callback/google
   FRONTEND_URL=https://myvroom.xyz
   CORS_ORIGINS=https://myvroom.xyz
   ```

5. `docker compose up -d`. The connection is outbound-only; Cloudflare terminates TLS.

No body-size tuning is needed: a restore upload tops out at 50MB, inside the 100MB
per-request limit of Cloudflare's free plan.

## Database

One SQLite file at `DATABASE_URL`, in WAL mode — so the data directory holds `vroom.db`
plus `vroom.db-wal` and `vroom.db-shm`. The migrations in `backend/drizzle/` are applied
automatically at startup; there is no manual migration step.

**Databases created before `0000_baseline` cannot be upgraded in place.** Their migration history
no longer matches the journal. To move one forward: export a backup from the old build, stop it,
move `vroom.db*` aside, start the new build (which creates a fresh schema), then restore the backup
through the UI. Keep the old file until the restore is verified.

### Backup

Stop the backend first. Shutdown checkpoints the WAL into the main file, which a hot copy of
`vroom.db` alone does not — the periodic checkpoint only runs every 15 minutes in production,
so a live copy can be missing recent commits.

```bash
docker compose stop backend
cp "$DATA_PATH/vroom.db" ./backups/vroom-$(date +%Y%m%d).db
docker compose start backend
```

To copy without stopping, take all three files (`vroom.db`, `-wal`, `-shm`) together.

VROOM also backs itself up to Google Drive (a ZIP of CSVs) and mirrors to Google Sheets —
configure both in Settings after login.

### Restore

```bash
docker compose stop backend
cp ./backups/vroom-backup.db "$DATA_PATH/vroom.db"
rm -f "$DATA_PATH/vroom.db-wal" "$DATA_PATH/vroom.db-shm"
docker compose start backend
```

Deleting the stale `-wal`/`-shm` matters: left behind, they belong to the replaced database.

In-app restore from a Drive ZIP or Google Sheets lives in Settings → Backup → Restore.

## Maintenance

```bash
docker compose ps
docker compose logs -f backend
docker stats vroom-backend vroom-frontend
curl http://localhost:3001/health
```

### Updates

```bash
docker compose pull
docker compose up -d
docker image prune -af --filter "until=168h"
```

Only containers whose image actually changed are recreated. To automate, run that from cron
in the directory holding your `docker-compose.yml` and `.env`:

```bash
0 * * * * cd /path/to/vroom && docker compose pull -q && docker compose up -d --remove-orphans && docker image prune -af --filter "until=168h"
```

The Portainer stack bundles Tugtainer, which does the same hourly for labelled containers.

## Hosting Platforms

| Platform | Cost | Notes |
|---|---|---|
| Home lab / Raspberry Pi 4 | free | Full control; pair with Cloudflare Tunnel to skip networking |
| VPS (DigitalOcean, Linode, Vultr, Hetzner) | $5–10/mo | Simplest remote option |
| [Oracle Cloud Free Tier](oci/README.md) | free | ARM VM up to 4 OCPU / 24GB RAM — [full guide](oci/README.md) |
| Synology / QNAP NAS | free | Docker via Package Center |

## Security Checklist

- [ ] HTTPS in front of the app — the production session cookie is `Secure`, so login fails without it
- [ ] `PROVIDER_ENCRYPTION_KEY` randomly generated (`openssl rand -hex 32`) and backed up alongside the database
- [ ] `CORS_ORIGINS` listing only your own origins
- [ ] Only 80/443 reachable from the internet (plus 22 for SSH). Behind a proxy or tunnel, drop the `ports:` mappings for 3000/3001 so they stay on the Docker network
- [ ] `TRUSTED_PROXY_IPS` set when behind a proxy, so rate limits key on real client IPs
- [ ] Images updated
- [ ] Backups configured
