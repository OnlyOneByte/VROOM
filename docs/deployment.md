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
optional variable from the tables below (GitHub or OIDC login, web push, `TRUSTED_PROXY_IPS`,
`BLOCK_PRIVATE_PROVIDER_ENDPOINTS`) takes effect
only after you add it to that block as well as to `.env`.

### Required in production

The backend logs the missing names and exits at startup without these.

| Variable | Description |
|---|---|
| A sign-in provider | At least one of: `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`, or `OIDC_ISSUER` + `OIDC_CLIENT_ID` + `OIDC_CLIENT_SECRET` |
| `PROVIDER_ENCRYPTION_KEY` | Exactly 64 hex chars. `openssl rand -hex 32` |

`PROVIDER_ENCRYPTION_KEY` is the AES-256-GCM key for stored provider credentials (Drive/Sheets
refresh tokens, S3 keys, LLM keys). Back it up with the database — if it changes, those
credentials no longer decrypt and every provider must be reconnected. Both example stacks pass
it through and `docs/examples/.env.example` carries a placeholder that fails the format check,
so an unedited copy exits with the variable named instead of encrypting with a published key.

Each stored secret is bound to its provider row and names the key that sealed it, so the key
can be rotated without reconnecting anything (see [Rotating the encryption key](#rotating-the-encryption-key)).

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
| `TRUSTED_PROXY_IPS` | empty | Comma-separated proxy IPs or CIDR ranges whose `X-Forwarded-For` is honored. It is read from the right: the nearest address that is not a trusted proxy is the client, so an entry a client added itself is ignored. Left unset behind a reverse proxy, every anonymous request shares one rate-limit bucket keyed on the proxy's IP. An invalid entry stops the backend at startup |
| `TRUSTED_CLIENT_IP_HEADER` | empty | A header a trusted proxy sets to the client IP, such as `CF-Connecting-IP`. Read only when the request comes from a `TRUSTED_PROXY_IPS` address, and before `X-Forwarded-For` |
| `BLOCK_PRIVATE_PROVIDER_ENDPOINTS` | off | Set to `1` to require public `https://` hosts for S3 endpoints and model base URLs. Off, `http://` and LAN or loopback hosts are allowed, so a self-hosted MinIO or Ollama works. Cloud metadata and link-local addresses are refused either way. Any signed-in user can point a provider at the server's own network while it is off, so turn it on for an instance other people can sign up to |
| `DEMO_MODE` | off | Set to `1` to offer a read-only demo garage from the landing page. Anyone who can reach the instance can open it without signing in, for an hour at a time. It is a separate account the server rebuilds with sample data on every start, so it never holds or sees anyone else's data; every change is refused with 403, and provider, backup, share, export and assistant endpoints are closed to it. Turning it off removes the demo account on the next start |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | — | Set both to add a GitHub login button. Callback defaults to `http://localhost:3001/api/v1/auth/callback/github`; override with `GITHUB_REDIRECT_URI`. Register the OAuth app's callback URL as `https://yourdomain.com/api/v1/auth/callback`: GitHub accepts any redirect under it, so login and account linking both work |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | — | Set all three to sign in with your own OpenID Connect provider (Authentik, Keycloak, Pocket ID and the like). The backend reads `OIDC_ISSUER/.well-known/openid-configuration` at startup (5 s timeout); if that fails, or names a different issuer, it logs the error, hides the OIDC button and tries again on a later sign-in request, at most every 30 s. Accounts are keyed by issuer and subject, so changing `OIDC_ISSUER` does not carry sign-ins over: a user whose email already has an account is refused until they sign in another way and link the new identity from Profile. Sign-in uses PKCE, asks for `openid profile email` only, and refuses an account whose `email_verified` is not `true` |
| `OIDC_REDIRECT_URI` | `http://localhost:3001/api/v1/auth/callback/oidc` | OIDC login callback. Register it, and the link callback below, with your provider |
| `OIDC_LINK_REDIRECT_URI` | derived from `OIDC_REDIRECT_URI` | Callback for linking OIDC to an account on Profile, `.../callback/link/oidc` |
| `OIDC_DISPLAY_NAME` | `Single sign-on` | Button label: "Continue with <name>" |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | — | Web push. All three or the feature stays off. Generate with `bun run vapid:gen` |
| `COMMUNITY_STATS` | `local` | `off` or `local`. With `local`, users can opt in from Settings › Community comparisons to compare their vehicles with other opted-in owners on this server. Everyone starts opted out. `off` stops the daily job and hides both the settings card and the vehicle comparison. See [Community stats](#community-stats) |
| `COMMUNITY_STATS_MIN_GROUP` | `10` | The fewest people a published group can have. You can raise it but not lower it: below `10` the backend refuses to start |
| `GOOGLE_PROVIDER_REDIRECT_URI` | derived from `GOOGLE_REDIRECT_URI` | Storage-connect callback. Override only if it must differ from the derived `.../callback/provider/google` |
| `GOOGLE_LINK_REDIRECT_URI`, `GITHUB_LINK_REDIRECT_URI` | derived from `GOOGLE_REDIRECT_URI` / `GITHUB_REDIRECT_URI` | Callback for linking a second sign-in account on Profile. Override only if it must differ from the derived `.../callback/link/google` or `.../callback/link/github` |
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
   - **Photos Library API** — the Google Photos storage provider: uploading photos and reading back the ones VROOM uploaded
3. APIs & Services → OAuth consent screen → Data Access → add the scopes VROOM requests:
   - `openid`, `../auth/userinfo.email`, `../auth/userinfo.profile` — login
   - `../auth/drive.file` — only the Drive files VROOM creates
   - `../auth/photoslibrary.readonly.appcreateddata` — only the photos VROOM uploaded
   - `../auth/photoslibrary.appendonly` — adding photos to the VROOM album. Asked for only when a
     user adds a Google Photos provider, as an incremental grant, so Drive users never see it
4. APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID, type
   Web application, with **all three** authorized redirect URIs:
   - `https://yourdomain.com/api/v1/auth/callback/google` — login
   - `https://yourdomain.com/api/v1/auth/callback/provider/google` — connecting Drive,
     Sheets, or Photos
   - `https://yourdomain.com/api/v1/auth/callback/link/google` — linking a second Google
     account on Profile

   The backend derives the last two from `GOOGLE_REDIRECT_URI`. Leaving one out of the
   console makes that flow fail with `redirect_uri_mismatch`.

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

Both example stacks pin `:latest`, i.e. the newest release. Switch them to `:dev` to track
`main`.

### Build from source

The example compose file only names images, so `docker compose build` has nothing to build.
Build both images from the repo root under the names the compose file uses, then start the
stack. Compose pulls only images that are missing locally, so it runs the ones you built:

```bash
docker build -t ghcr.io/onlyonebyte/vroom/backend:latest backend
docker build -t ghcr.io/onlyonebyte/vroom/frontend:latest frontend
docker compose up -d
```

Don't run `docker compose pull` afterwards: it replaces your builds with the published images.

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

Do not route `/auth` to the backend: it is the frontend sign-in page. OAuth providers call back to
`/api/v1/auth/callback/*`, which the `/api/*` rule already sends to the backend.

Set `CORS_ORIGINS` and `FRONTEND_URL` to the public origin, leave `PUBLIC_API_URL` empty, and
set `TRUSTED_PROXY_IPS` to the proxy's address so rate limiting keys on the real client IP:

| In front of the backend | `TRUSTED_PROXY_IPS` | `TRUSTED_CLIENT_IP_HEADER` |
|---|---|---|
| Caddy or nginx on the same host | `127.0.0.1` | — |
| Cloudflare Tunnel (`cloudflared` in the stack) | the stack network, e.g. `172.16.0.0/12` | `CF-Connecting-IP` |
| Cloudflare proxy → Caddy or nginx | `127.0.0.1` | `CF-Connecting-IP` (Caddy and nginx pass it through unchanged) |

Behind a Cloudflare-proxied host, firewall ports 80 and 443 to Cloudflare's published ranges, or
a client can reach the proxy directly and set `CF-Connecting-IP` itself.

Upstreams below use `127.0.0.1` rather than `localhost`: the backend binds one loopback
address (`HOST`, `127.0.0.1` by default), while `localhost` resolves to both families and
which one a proxy dials first depends on the host's resolver.

### Caddy

```
yourdomain.com {
    encode zstd gzip
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

The backend gzips its own JSON and CSV responses when the client accepts gzip. `encode`
compresses the frontend's pages too, and leaves responses the backend already compressed as
they are. Caddy compresses nothing without it.

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

    gzip on;
    gzip_types application/json text/csv text/css application/javascript image/svg+xml;

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

nginx's own `gzip` covers only `text/html` unless `gzip_types` names more. The backend already
gzips its JSON and CSV, and nginx passes those through as they are; the two lines above
compress the frontend's pages and assets.

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
no longer matches the journal. To move one forward:

1. In the old build, Settings → Storage Providers → **Download Backup** saves a ZIP (builds from
   before 2026-03-12 have the button on the **Data Backups** card).
2. Stop the old build and move `vroom.db*` aside.
3. Start the new build, which creates a fresh schema, and sign in with the same account. The fresh
   database gives you a new internal user id; restore re-owns every row to the signed-in account,
   so a backup made under the old id still applies.
4. Settings → Storage Providers: reconnect the same storage accounts you used before (the same
   Google account, or the same S3 endpoint and bucket).
5. Settings → Storage Providers → **Restore** → **Upload file**: pick the ZIP, check the preview
   counts, then restore with **Replace All**.

Keep the old file until the restore is verified. What happens to links into the old database:

- **Photos**: each photo is re-linked to the reconnected provider for the same storage account, so
  it displays again. Photos whose storage account isn't connected when you restore stay
  unlinked; their files are still in that storage. Google Drive only lets an app open files that
  same app created, so Drive photos display again only when the new instance uses the same Google
  OAuth client ID. Backups made before this release and Google Sheets restores carry no storage
  account details, so they don't re-link.
- **Vehicle shares**: re-invite people once they have signed in to the new instance.
- **Backup and photo storage settings**: set them up again for the reconnected providers.
  Settings you already made for a provider on the new instance are kept.

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

In-app restore from a Drive ZIP or Google Sheets lives in Settings → Storage Providers → Restore.

## Community stats

With `COMMUNITY_STATS=local`, which is the default, a background job runs once a day. It turns the data of users who opted in into anonymous group averages and stores them in the `community_stats` table, where opted-in users can compare their own vehicles against them. Nothing leaves the server and no outbound request is made.

- **What it reads:** for opted-in owners only:
  - the vehicle's catalogue model (the one the owner picked or confirmed), model year, powertrain and units;
  - the owner's currency and region;
  - the last 12 months of fuel and maintenance expenses (amount, date, fuel type, volume, odometer and the missed-fill-up flag);
  - the insurance premiums whose term overlaps those 12 months, with each term's start and end date, so a premium counts only for the part of its term inside the window;
  - the odometer readings in that window;
  - the date of each vehicle's earliest record, used to check it was owned for the whole window.

  Dates and odometer readings are used only to pick the window, check ownership and measure the distance driven. It never reads VINs, plates, nicknames, notes, descriptions, photos, locations, or purchase and financing details.
- **What it stores:** groups of at least `COMMUNITY_STATS_MIN_GROUP` people. Each group has a count rounded down to a multiple of 5 and one average. The average has Laplace noise scaled to the group's rounded size and is then rounded, which gives ε = 1 per group per refresh against a change in one person's values. The rounded count, and whether a group appears at all, are not noised, so one person joining or leaving is protected only by the group minimum and the rounding (#1591). No medians or ranges are published. No user ids or per-person rows are stored.
- **What users see:** an average is shown only when its noise scale is at most 25% of the average itself. Smaller groups show "Not enough owners yet for a reliable average" instead of a number. With today's bands that means about 20 owners for an efficiency average of 12 km/L, 90 for a running cost of 9 cents/km, 135 for maintenance of 600 a year and 70 for insurance of 1,200 a year. Groups with lower averages need more owners.
- **What you see as an admin:** one info line per run, with counts only, for example `community stats refreshed: 7 buckets published, 31 suppressed (n<K), 18 opted-in owners, 412 ms`. A run that takes over 30 s adds a warning with its duration. A failed run logs an error naming only the underlying cause (for example `SQLiteError: database is locked`), never the query or its values. There's no admin UI listing who opted in. As with any other column, you can query `user_preferences.community_stats_opt_in` in the database directly.
- **Backups:** `community_stats` and `community_refreshes` (the time of the last refresh) are left out of backups and the Sheets mirror. They are derived, cover the whole server and are rebuilt daily, and restoring them on another server would bring in another server's population. Restoring a backup never turns a user's opt-in on: a backup that holds preferences restores them with opt-in off, because consent belongs to a person on a server and doesn't travel in a backup file.
- **Who sees comparisons:** only users whose opt-in came before the last completed refresh, so their data has already been through the job. This holds even when that refresh published no groups, in which case they see "not enough owners yet". Until then they see a short "after the next refresh" note.
- **Opting out:** a user who turns it off stops seeing comparisons at once and is left out from the next daily refresh. Setting `COMMUNITY_STATS=off` stops the job and stops serving comparisons. Rows already in `community_stats` stay in the table until a later refresh replaces them.

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

### Rotating the encryption key

`PROVIDER_ENCRYPTION_KEYS` holds a comma-separated list of `id=hex` keys. The first one
encrypts every new secret; the others are only used to read older ones. A lone
`PROVIDER_ENCRYPTION_KEY` counts as the key with the id `default`. When both are set and the
list already names `default`, the list wins and `PROVIDER_ENCRYPTION_KEY` is ignored.

1. Generate a new key: `openssl rand -hex 32`.
2. Put it first and keep the old one, then restart the backend:
   `PROVIDER_ENCRYPTION_KEYS=k2=<new key>,default=<old key>` (or keep `PROVIDER_ENCRYPTION_KEY`
   set to the old key; it is read as `default`). The example stacks list the backend's
   environment explicitly, so add `PROVIDER_ENCRYPTION_KEYS` to the backend's `environment:`
   block there too.
3. Re-encrypt every stored secret under the new key:
   - in the container: `docker compose exec backend bun dist/scripts/rotate-provider-keys.js`
     (on Portainer, open the backend container's console and run
     `bun dist/scripts/rotate-provider-keys.js`)
   - from a checkout, in `backend/`: `bun run providers:rotate-key`

   It works in batches of 100 rows, one transaction each, and prints how many rows it
   re-encrypted, how many were already on the current key and how many had no secret. It exits
   non-zero and lists the ids of any row no configured key can read; those rows are left
   unchanged.
4. Once it reports no unreadable rows, remove the old key from both variables
   (`PROVIDER_ENCRYPTION_KEYS` and `PROVIDER_ENCRYPTION_KEY`) and restart. Back up the new key
   with the database.

Secrets stored before key ids existed are read only with the key whose id is `default`, so
the old key must keep that id in the list (`default=<old key>`), not a new one like `k1`.
Running the command with a single key upgrades them in place, but that old format stays
readable for as long as a `default` key is configured. Rotating to a new key id and then
removing `default` turns it off.

## Hosting Platforms

| Platform | Cost | Notes |
|---|---|---|
| Home lab / Raspberry Pi 4 | free | Full control; pair with Cloudflare Tunnel to skip networking |
| VPS (DigitalOcean, Linode, Vultr, Hetzner) | $5–10/mo | Simplest remote option |
| [Oracle Cloud Free Tier](oci/README.md) | free | ARM VM up to 4 OCPU / 24GB RAM — [full guide](oci/README.md) |
| Synology / QNAP NAS | free | Docker via Package Center |

## Calendar links

Each user can create a private calendar link in Settings → Calendar, which Google, Apple and Outlook Calendar subscribe to. The link carries a long random secret in its path (`/api/v1/calendar/feed/<secret>.ics`); anyone holding it can read that user's feed until they replace or turn it off. VROOM stores only a hash of the secret and prints the path with the secret replaced by `[redacted]` in its own request log.

**Your reverse proxy logs the full URL**, secret included, unless you filter it. Calendar apps fetch the link from their own servers every few hours, so the access log fills with working links. Filter it out before it is written. These filters replace any run of 40 or more letters, digits, `-`, `_` or `%` in the request URI, so they also catch a link written with percent-escapes (VROOM answers those with 404, but the secret would still be in the log):

- **Caddy:**

  ```caddyfile
  log {
      format filter {
          request>uri regexp [A-Za-z0-9_%-]{40,} [redacted]
      }
  }
  ```

- **nginx** (in the `http` block, then use the format in `access_log`):

  ```nginx
  map $request_uri $vroom_logged_uri {
      "~^(?<pre>[^?]*?)[A-Za-z0-9_%-]{40,}(?<rest>.*)$" "${pre}[redacted]${rest}";
      default $request_uri;
  }
  log_format vroom '$remote_addr - [$time_local] "$request_method $vroom_logged_uri" $status $body_bytes_sent';
  access_log /var/log/nginx/access.log vroom;
  ```

- **Error logs:** both servers can write the request line to their error log (for example on a timeout); keep error logs at a level that omits request URIs, or treat them like the secret itself.
- **Cloudflare Tunnel:** Cloudflare's own request logs (if you enable Logpush) include the path; exclude `/api/v1/calendar/feed/` there or accept that Cloudflare sees the links.

## Security Checklist

- [ ] HTTPS in front of the app — the production session cookie is `Secure`, so login fails without it
- [ ] `PROVIDER_ENCRYPTION_KEY` randomly generated (`openssl rand -hex 32`) and backed up alongside the database
- [ ] `CORS_ORIGINS` listing only your own origins
- [ ] Only 80/443 reachable from the internet (plus 22 for SSH). Behind a proxy or tunnel, drop the `ports:` mappings for 3000/3001 so they stay on the Docker network
- [ ] Bind to 127.0.0.1 when behind a reverse proxy on the same host: publish each port as `"127.0.0.1:3000:3000"` (the example stacks show this form above each mapping). A bare `"3000:3000"` listens on every interface, and Docker's published ports bypass host firewalls such as ufw
- [ ] `TRUSTED_PROXY_IPS` set when behind a proxy, so rate limits key on real client IPs
- [ ] Images updated
- [ ] Backups configured
- [ ] Reverse proxy access logs filter calendar links (see [Calendar links](#calendar-links))
