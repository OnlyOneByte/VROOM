# Deploying VROOM on Oracle Cloud (Always Free Tier)

OCI's Always Free tier runs VROOM comfortably at zero cost. This guide covers only the
OCI-specific steps; everything else — environment variables, Google OAuth, the Caddyfile,
backups, updates — is in the [Deployment Guide](../deployment.md).

## Why OCI

The Always Free tier includes an ARM VM (Ampere A1) of up to 4 OCPUs and 24GB RAM, 200GB of
block volume, and 10TB/mo of outbound transfer. The ARM instance is the pick for VROOM —
overkill for a personal app, which means you never hit a limit.

Tradeoffs: you manage the VM yourself, the console is clunky, there is no managed deploy
pipeline, and ARM capacity gets claimed fast in popular regions ("out of host capacity" —
retry, or try another region such as US-Ashburn, US-Phoenix, UK-London, or Frankfurt).

## Prerequisites

- An [Oracle Cloud account](https://www.oracle.com/cloud/free/) (card required at signup;
  Always Free resources are not charged)
- A domain name, for HTTPS
- Google OAuth credentials ready — see
  [Google OAuth Setup](../deployment.md#google-oauth-setup)

## 1. Create the VM

In the [OCI Console](https://cloud.oracle.com/): **Compute → Instances → Create Instance**.

- **Image**: Ubuntu 22.04 or 24.04 Minimal aarch64
- **Shape**: VM.Standard.A1.Flex — 2 OCPUs / 12GB RAM leaves room for a second instance
- **Networking**: new or existing VCN, with a public IP
- **SSH key**: upload your public key, or let OCI generate one and save the private key
- **Boot volume**: the 50GB default is plenty

## 2. Open ports 80 and 443

OCI filters traffic twice — in the subnet's Security List and in the instance's iptables.
Both need the ports.

**Security List** (Networking → Virtual Cloud Networks → your VCN → Subnets → your subnet →
Security Lists) — add ingress rules for TCP 80 and TCP 443 from `0.0.0.0/0`. SSH on 22 is
already open.

**iptables**, over SSH:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Nothing needs to reach ports 3000 or 3001 from outside — Caddy proxies to them over
localhost.

## 3. Install Docker

```bash
ssh -i /path/to/private-key ubuntu@<instance-ip>

sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
sudo apt install docker-compose-plugin -y

exit   # log back in for the group change to apply
```

Verify with `docker --version && docker compose version`.

## 4. Deploy

Follow the [Quick Start](../deployment.md#quick-start), with `DATA_PATH` pointing at a
directory you create on the instance:

```bash
git clone https://github.com/OnlyOneByte/VROOM.git
cd VROOM
cp docs/examples/docker-compose.yml docker-compose.yml
cp docs/examples/.env.example .env
mkdir -p /home/ubuntu/vroom-data
nano .env   # DATA_PATH=/home/ubuntu/vroom-data, plus the variables below
```

Fill in `.env` from
[Environment Variables](../deployment.md#environment-variables) — `PROVIDER_ENCRYPTION_KEY`
in particular is missing from the template and the backend refuses to start without it. Keep
the compose file at the repo root next to `.env`: Compose reads `.env` from the compose
file's own directory, not from your shell's.

```bash
docker compose up -d
```

## 5. Reverse proxy with Caddy

Install Caddy, then write the Caddyfile from
[Reverse Proxy + SSL](../deployment.md#reverse-proxy--ssl) to `/etc/caddy/Caddyfile`:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy -y

sudo nano /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

Point your domain's A record at the instance's public IP. Caddy then issues the certificate
on first request.

## 6. Verify

```bash
docker compose ps
curl http://localhost:3001/health
sudo systemctl status caddy
docker compose logs -f backend
```

Then open `https://yourdomain.com` — you should get the VROOM login page.

## Maintenance

SSH back in with `ssh -i /path/to/private-key ubuntu@<instance-ip>`. Updates, backups, and
the auto-update cron job are in the deployment guide's
[Maintenance](../deployment.md#maintenance) and [Database](../deployment.md#database)
sections; `DATA_PATH` is wherever you set it above. `docker stats`, `htop`, and `df -h` cover
resource monitoring — with this shape you will barely touch it.
