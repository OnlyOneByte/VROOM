# Deploying VROOM on Oracle Cloud (Always Free Tier)

Oracle Cloud Infrastructure (OCI) offers an Always Free tier that's generous enough to run VROOM comfortably — at zero cost.

## Why OCI?

The Always Free tier includes:

- **ARM VM (Ampere A1)**: Up to 4 OCPUs and 24GB RAM — more than most paid VPS providers offer under $20/mo
- **AMD VMs**: 2 instances with 1/8 OCPU and 1GB RAM each
- **Storage**: 200GB total block volume
- **Networking**: 10TB/mo outbound data transfer

The ARM instance is the best pick for VROOM. 4 cores and 24GB RAM is overkill for a personal app, but it means you'll never hit resource limits.

## Tradeoffs

- **More setup than managed platforms** — you're managing the VM yourself (installing Docker, configuring firewall, etc.)
- **Oracle's console is clunky** — the cloud UI isn't great, but you only need it for initial setup
- **ARM instance availability** — these get snapped up fast in popular regions. If you hit "out of capacity," try a different region or keep retrying
- **No managed deploy pipeline** — you'll set up your own with GitHub Actions or deploy manually

## Prerequisites

- An [Oracle Cloud account](https://www.oracle.com/cloud/free/) (credit card required for signup, but free tier resources are never charged)
- A domain name (optional but recommended for HTTPS)
- Your Google OAuth credentials ready (see [Google OAuth Setup](../deployment.md#google-oauth-setup))

## Step 1: Create an ARM VM Instance

1. Log into the [OCI Console](https://cloud.oracle.com/)
2. Navigate to **Compute → Instances → Create Instance**
3. Configure:
   - **Image**: Ubuntu 22.04 (or 24.04) Minimal aarch64
   - **Shape**: VM.Standard.A1.Flex — set to 2 OCPUs / 12GB RAM (leaves room for a second instance if needed)
   - **Networking**: Create a new VCN or use an existing one. Assign a public IP.
   - **SSH key**: Upload your public key or let OCI generate one (save the private key)
   - **Boot volume**: 50GB (default) is plenty

4. Click **Create** and wait for the instance to be running

> **Tip**: If you get "Out of host capacity," try regions like US-Ashburn, US-Phoenix, UK-London, or Frankfurt. Availability fluctuates.

## Step 2: Configure Firewall Rules

OCI uses both **Security Lists** (cloud-level) and **iptables** (OS-level). You need to open ports in both.

### OCI Security List

1. Go to **Networking → Virtual Cloud Networks → your VCN → Subnets → your subnet → Security Lists**
2. Add **Ingress Rules**:

| Source CIDR | Protocol | Dest Port | Description |
|---|---|---|---|
| `0.0.0.0/0` | TCP | 80 | HTTP |
| `0.0.0.0/0` | TCP | 443 | HTTPS |

SSH (port 22) should already be open by default.

### OS-level iptables

Ubuntu on OCI comes with restrictive iptables rules. Open the ports:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## Step 3: Install Docker

SSH into your instance and install Docker:

```bash
ssh -i /path/to/private-key ubuntu@<your-instance-ip>

# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Install Docker Compose plugin
sudo apt install docker-compose-plugin -y

# Log out and back in for group changes
exit
ssh -i /path/to/private-key ubuntu@<your-instance-ip>

# Verify
docker --version
docker compose version
```

## Step 4: Deploy VROOM

```bash
# Clone the repo
git clone https://github.com/OnlyOneByte/vroom.git
cd vroom

# Set up environment
cp docs/examples/.env.example .env
```

Edit `.env` with your configuration (see [Environment Variables](../deployment.md#environment-variables)):

```bash
nano .env
```

Key values to set:

```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_secret
GOOGLE_REDIRECT_URI=https://yourdomain.com/api/v1/auth/callback/google
SESSION_SECRET=$(openssl rand -base64 32)
FRONTEND_URL=https://yourdomain.com
CORS_ORIGINS=https://yourdomain.com
PUBLIC_API_URL=https://yourdomain.com
DATA_PATH=/home/ubuntu/vroom-data
```

Create the data directory and start the app:

```bash
mkdir -p /home/ubuntu/vroom-data
docker compose -f docs/examples/docker-compose.yml up -d
```

## Step 5: Set Up Reverse Proxy (Caddy)

Caddy is the simplest option — it handles HTTPS automatically:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy -y
```

Create the Caddyfile:

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
yourdomain.com {
    handle /api/* {
        reverse_proxy localhost:3001
    }
    handle /auth/* {
        reverse_proxy localhost:3001
    }
    handle /health {
        reverse_proxy localhost:3001
    }
    handle {
        reverse_proxy localhost:3000
    }
}
EOF

sudo systemctl restart caddy
```

Replace `yourdomain.com` with your actual domain. Point your domain's DNS A record to the instance's public IP.

## Step 6: Enable Auto-Updates (Optional)

Create a script that checks for new images and restarts containers:

```bash
cat > /home/ubuntu/vroom-update.sh << 'EOF'
#!/bin/bash
cd /home/ubuntu/vroom
docker compose -f docs/examples/docker-compose.yml pull --quiet
docker compose -f docs/examples/docker-compose.yml up -d --remove-orphans
docker image prune -af --filter "until=168h"
EOF
chmod +x /home/ubuntu/vroom-update.sh
```

Add a cron job to run it hourly:

```bash
(crontab -l 2>/dev/null; echo "0 * * * * /home/ubuntu/vroom-update.sh >> /var/log/vroom-update.log 2>&1") | crontab -
```

This pulls the latest images, restarts only containers with updated images, and cleans up old images older than 7 days.

## Verifying the Deployment

```bash
# Check containers are running
docker compose -f docs/examples/docker-compose.yml ps

# Check backend health
curl http://localhost:3001/health

# Check Caddy status
sudo systemctl status caddy

# Check logs if something's wrong
docker compose -f docs/examples/docker-compose.yml logs -f backend
```

Visit `https://yourdomain.com` — you should see the VROOM login page.

## Maintenance

### SSH Access

```bash
ssh -i /path/to/private-key ubuntu@<your-instance-ip>
```

### Manual Updates

```bash
cd ~/vroom
git pull
docker compose -f docs/examples/docker-compose.yml pull
docker compose -f docs/examples/docker-compose.yml up -d
docker image prune -a
```

### Database Backups

```bash
# Local backup
cp /home/ubuntu/vroom-data/vroom.db ~/backups/vroom-$(date +%Y%m%d).db
```

Also configure Google Drive backup in VROOM's Settings for automated off-site backups.

### Monitoring Resource Usage

```bash
# Container stats
docker stats

# System resources
htop
df -h
```

With 4 OCPUs and 24GB RAM, you'll barely touch the resources for personal use.
