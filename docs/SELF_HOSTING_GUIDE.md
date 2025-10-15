# VROOM Self-Hosting Guide

Complete guide for self-hosting VROOM Car Tracker on your own infrastructure.

## Table of Contents

- [Why Self-Host?](#why-self-host)
- [System Requirements](#system-requirements)
- [Installation Methods](#installation-methods)
- [Google API Configuration](#google-api-configuration)
- [Storage Options](#storage-options)
- [Deployment Platforms](#deployment-platforms)
- [Maintenance](#maintenance)
- [Troubleshooting](#troubleshooting)

## Why Self-Host?

VROOM is designed for self-hosting to give you:

- **Complete Data Control**: Your vehicle and expense data stays on your infrastructure
- **Privacy**: No third-party access to your financial information
- **Customization**: Modify the application to fit your specific needs
- **Cost Control**: Use free-tier cloud services or existing home lab infrastructure
- **Learning**: Great project for learning Docker, databases, and web deployment

## System Requirements

### Minimum Requirements

- **CPU**: 1 core (2 cores recommended)
- **RAM**: 512MB (1GB recommended)
- **Storage**: 2GB for application + database growth
- **OS**: Linux, macOS, or Windows with Docker support
- **Network**: Internet connection for OAuth and Google Sheets sync

### Recommended Platforms

- **Home Lab**: Raspberry Pi 4, Intel NUC, or any x86_64 server
- **VPS**: DigitalOcean, Linode, Vultr, Hetzner ($5-10/month)
- **Cloud Free Tier**: Oracle Cloud (always free), AWS Free Tier, Google Cloud Free Tier
- **NAS**: Synology, QNAP, or Unraid with Docker support

## Installation Methods

### Method 1: Docker Compose (Recommended)

Best for most users. Provides easy setup and management.

```bash
# Clone repository
git clone https://github.com/your-username/vroom.git
cd vroom

# Configure environment
cp .env.example .env
nano .env  # Edit with your settings

# Start services
docker-compose -f docker-compose.prod.yml up -d

# Check status
docker-compose -f docker-compose.prod.yml ps
```

**Pros:**
- Simple setup and updates
- Isolated environment
- Easy to backup and restore
- Works on any platform with Docker

**Cons:**
- Requires Docker knowledge
- Slightly higher resource usage

### Method 2: Portainer Stack

Best for users who prefer a web UI for container management.

1. Install Portainer (see [DEPLOYMENT.md](../DEPLOYMENT.md#portainer-integration))
2. Access Portainer web UI at `http://your-server:9000`
3. Go to **Stacks** → **Add Stack**
4. Upload `portainer-stack.yml` or paste its contents
5. Add environment variables
6. Deploy the stack

**Pros:**
- User-friendly web interface
- Visual container management
- Built-in monitoring
- Easy updates via UI

**Cons:**
- Additional service to manage
- Requires Portainer installation

### Method 3: Manual Installation

For advanced users who want full control.

#### Backend Setup

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Navigate to backend
cd backend

# Install dependencies
bun install

# Configure environment
cp .env.example .env
nano .env

# Initialize database
bun run db:init

# Start server
bun run start
```

#### Frontend Setup

```bash
# Navigate to frontend
cd frontend

# Install dependencies
npm install

# Build for production
npm run build

# Serve with static file server
npx serve -s build -l 3000
```

**Pros:**
- Maximum control
- Lower resource usage
- No Docker overhead

**Cons:**
- More complex setup
- Manual dependency management
- Platform-specific issues

## Google API Configuration

VROOM requires Google OAuth for authentication and optionally Google Drive/Sheets for backup.

### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **Select a project** → **New Project**
3. Enter project name: "VROOM Car Tracker"
4. Click **Create**

### Step 2: Enable Required APIs

1. Go to **APIs & Services** → **Library**
2. Search and enable:
   - **Google+ API** (for OAuth)
   - **Google Drive API** (for backup, optional)
   - **Google Sheets API** (for backup, optional)

### Step 3: Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Select **External** (unless you have Google Workspace)
3. Fill in required fields:
   - **App name**: VROOM Car Tracker
   - **User support email**: Your email
   - **Developer contact**: Your email
4. Click **Save and Continue**
5. Skip **Scopes** (click **Save and Continue**)
6. Add test users (your email addresses)
7. Click **Save and Continue**

### Step 4: Create OAuth Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth 2.0 Client ID**
3. Select **Web application**
4. Configure:
   - **Name**: VROOM Production
   - **Authorized JavaScript origins**:
     - `http://localhost:5173` (development)
     - `https://yourdomain.com` (production)
   - **Authorized redirect URIs**:
     - `http://localhost:3001/auth/callback/google` (development)
     - `https://yourdomain.com/auth/callback/google` (production)
5. Click **Create**
6. **Save the Client ID and Client Secret**

### Step 5: Configure VROOM

Add credentials to your `.env` file:

```env
GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=https://yourdomain.com/auth/callback/google
```

### Step 6: Enable Google Drive/Sheets (Optional)

For backup functionality:

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **API Key**
3. Copy the API key
4. Add to `.env`:

```env
GOOGLE_DRIVE_API_KEY=your_api_key_here
```

**Note**: Users will grant Drive/Sheets access via OAuth when they enable backup features.

### Common OAuth Issues

#### Redirect URI Mismatch

**Error**: `redirect_uri_mismatch`

**Solution**: Ensure the redirect URI in Google Cloud Console exactly matches your configuration:
- Include protocol (`http://` or `https://`)
- Match domain exactly (including `www` if used)
- Include port for development (`:3001`)
- Path must be `/auth/callback/google`

#### Access Blocked: Authorization Error

**Error**: "This app hasn't been verified by Google"

**Solution**: 
- For personal use: Click "Advanced" → "Go to VROOM (unsafe)"
- For public use: Submit app for verification (not needed for self-hosting)

#### Invalid Client

**Error**: `invalid_client`

**Solution**: Double-check Client ID and Client Secret in `.env` file

## Storage Options

VROOM uses a hybrid storage approach:

### Primary Storage: SQLite

- **Location**: `./backend/data/vroom.db`
- **Backup**: Automatic with Google Sheets sync
- **Size**: Typically < 50MB for years of data
- **Performance**: Excellent for single-user or small family use

### Backup Storage: Google Sheets

- **Purpose**: Human-readable backup and data portability
- **Sync**: Automatic after inactivity or manual trigger
- **Access**: View/edit data directly in Google Sheets
- **Cost**: Free (Google Drive storage)

### Future Storage Options

The architecture supports adding:
- PostgreSQL for multi-user deployments
- Oracle Cloud Database (20GB free forever)
- Azure Cosmos DB (25GB free forever)

## Deployment Platforms

### Home Lab / Raspberry Pi

Perfect for complete control and zero ongoing costs.

**Setup:**
```bash
# Install Docker on Raspberry Pi
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker pi

# Clone and deploy
git clone https://github.com/your-username/vroom.git
cd vroom
cp .env.example .env
nano .env  # Configure
docker-compose -f docker-compose.prod.yml up -d
```

**Access:**
- Local network: `http://raspberrypi.local:3000`
- Remote access: Set up port forwarding or VPN

**Pros:**
- Zero monthly cost
- Complete control
- Great learning experience

**Cons:**
- Requires home server
- Need to manage networking
- Uptime depends on your infrastructure

### VPS (DigitalOcean, Linode, Vultr)

Best for reliable remote access.

**Recommended Specs:**
- 1GB RAM / 1 CPU
- 25GB SSD
- Cost: $5-10/month

**Setup:**
```bash
# SSH into VPS
ssh root@your-vps-ip

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Clone and deploy
git clone https://github.com/your-username/vroom.git
cd vroom
cp .env.example .env
nano .env
docker-compose -f docker-compose.prod.yml up -d

# Set up reverse proxy (Nginx/Caddy)
# Configure SSL with Let's Encrypt
```

**Pros:**
- Reliable uptime
- Easy remote access
- Professional infrastructure

**Cons:**
- Monthly cost
- Requires basic server management

### Oracle Cloud (Always Free)

Best for free cloud hosting.

**Free Tier Includes:**
- 2 AMD VMs (1GB RAM each)
- 200GB block storage
- 10TB outbound transfer/month

**Setup:**
1. Create Oracle Cloud account
2. Create Compute Instance (Ubuntu)
3. Configure security rules (ports 80, 443, 3000, 3001)
4. SSH and deploy using Docker Compose

**Pros:**
- Completely free forever
- Generous resources
- Professional cloud infrastructure

**Cons:**
- Complex initial setup
- Aggressive account verification
- Can be terminated if unused

### Synology/QNAP NAS

Best if you already have a NAS.

**Setup:**
1. Enable Docker in Package Center
2. Open Docker app
3. Go to Registry → Search "vroom"
4. Download images
5. Create containers with environment variables
6. Configure reverse proxy in DSM

**Pros:**
- Use existing hardware
- Built-in backup solutions
- User-friendly interface

**Cons:**
- Requires NAS device
- Limited to NAS capabilities

## Maintenance

### Regular Tasks

#### Daily (Automated)
- Database backups via Google Sheets sync
- Log rotation
- Health checks

#### Weekly
- Check container logs for errors
- Review disk usage
- Verify backups are working

#### Monthly
- Update Docker images
- Review and clean old data
- Check for security updates

### Backup Strategy

#### Automatic Backups

VROOM automatically backs up to Google Sheets:
- After 5 minutes of inactivity (configurable)
- Manual trigger via UI
- Scheduled daily backups

#### Manual Database Backup

```bash
# Backup SQLite database
docker-compose -f docker-compose.prod.yml exec backend \
  cp /app/data/vroom.db /app/data/vroom-backup-$(date +%Y%m%d).db

# Copy to host
docker cp vroom-backend:/app/data/vroom-backup-$(date +%Y%m%d).db ./backups/

# Compress backup
gzip ./backups/vroom-backup-$(date +%Y%m%d).db
```

#### Restore from Backup

```bash
# Stop services
docker-compose -f docker-compose.prod.yml down

# Restore database
cp ./backups/vroom-backup-20240115.db ./backend/data/vroom.db

# Start services
docker-compose -f docker-compose.prod.yml up -d
```

### Updates

#### Update Docker Images

```bash
# Pull latest images
docker-compose -f docker-compose.prod.yml pull

# Restart with new images
docker-compose -f docker-compose.prod.yml up -d

# Clean old images
docker image prune -a
```

#### Automatic Updates

Enable Watchtower for automatic updates:

```bash
docker-compose -f docker-compose.prod.yml --profile auto-update up -d
```

Watchtower checks for updates hourly and automatically updates containers.

### Monitoring

#### Check Service Health

```bash
# Container status
docker-compose -f docker-compose.prod.yml ps

# Backend health
curl http://localhost:3001/health

# View logs
docker-compose -f docker-compose.prod.yml logs -f
```

#### Resource Usage

```bash
# Container stats
docker stats vroom-backend vroom-frontend

# Disk usage
du -sh ./backend/data
docker system df
```

## Troubleshooting

### Application Won't Start

**Check logs:**
```bash
docker-compose -f docker-compose.prod.yml logs backend
```

**Common causes:**
- Missing environment variables
- Port conflicts
- Database corruption
- Insufficient permissions

### Can't Login with Google

**Check:**
1. OAuth credentials are correct in `.env`
2. Redirect URI matches Google Cloud Console
3. Backend is accessible at the configured URL
4. CORS origins are configured correctly

**Test OAuth:**
```bash
# Check backend health
curl http://localhost:3001/health

# Test OAuth endpoint
curl http://localhost:3001/auth/login/google
```

### Database Locked Error

**Solution:**
```bash
# Stop services
docker-compose -f docker-compose.prod.yml down

# Remove lock files
rm -f ./backend/data/*.db-shm ./backend/data/*.db-wal

# Restart
docker-compose -f docker-compose.prod.yml up -d
```

### Google Sheets Sync Failing

**Check:**
1. User has granted Drive/Sheets permissions
2. Google Drive API is enabled
3. Network connectivity to Google APIs
4. Check backend logs for specific errors

### High Memory Usage

**Solutions:**
```bash
# Restart services
docker-compose -f docker-compose.prod.yml restart

# Limit container memory
# Add to docker-compose.prod.yml:
services:
  backend:
    mem_limit: 512m
  frontend:
    mem_limit: 256m
```

### Port Already in Use

**Find and kill process:**
```bash
# Find process
sudo lsof -i :3001

# Kill process
sudo kill -9 <PID>

# Or change port in .env
BACKEND_PORT=3002
```

## Security Considerations

### Essential Security Measures

1. **Use HTTPS**: Set up SSL/TLS with Let's Encrypt
2. **Strong Secrets**: Generate secure random strings
3. **Firewall**: Only expose necessary ports
4. **Regular Updates**: Keep Docker images updated
5. **Backup Encryption**: Encrypt sensitive backups
6. **Access Control**: Use VPN for remote access

### Recommended Security Setup

```bash
# Generate strong session secret
openssl rand -base64 32

# Set up firewall (UFW on Ubuntu)
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable

# Set up fail2ban for SSH protection
sudo apt-get install fail2ban
```

### SSL/TLS with Let's Encrypt

Using Caddy (easiest):
```bash
# Install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy

# Configure Caddyfile
sudo nano /etc/caddy/Caddyfile
```

Caddyfile:
```
yourdomain.com {
    reverse_proxy localhost:3000
}

api.yourdomain.com {
    reverse_proxy localhost:3001
}
```

```bash
# Reload Caddy
sudo systemctl reload caddy
```

## Getting Help

### Resources

- **Documentation**: [GitHub Wiki](https://github.com/your-username/vroom/wiki)
- **Issues**: [GitHub Issues](https://github.com/your-username/vroom/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-username/vroom/discussions)

### Before Asking for Help

1. Check logs: `docker-compose logs`
2. Verify environment variables
3. Test with minimal configuration
4. Search existing issues
5. Include relevant logs and configuration (remove secrets!)

### Community Support

- Share your setup and experiences
- Help others with similar issues
- Contribute improvements and fixes
- Report bugs and suggest features

## Next Steps

After successful deployment:

1. **Test Authentication**: Login with Google
2. **Add a Vehicle**: Create your first vehicle profile
3. **Enter Expenses**: Add some test expenses
4. **Enable Backup**: Configure Google Sheets sync
5. **Install as PWA**: Add to home screen on mobile
6. **Set Up Monitoring**: Configure health checks
7. **Schedule Backups**: Automate database backups

Enjoy tracking your vehicle expenses with complete control over your data!
