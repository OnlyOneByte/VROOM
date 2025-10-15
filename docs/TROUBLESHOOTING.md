# VROOM Troubleshooting Guide

Common issues and their solutions for VROOM Car Tracker.

## Table of Contents

- [Installation Issues](#installation-issues)
- [Authentication Problems](#authentication-problems)
- [Database Issues](#database-issues)
- [Google Integration](#google-integration)
- [Performance Issues](#performance-issues)
- [Network and Connectivity](#network-and-connectivity)
- [Docker Issues](#docker-issues)
- [FAQ](#faq)

## Installation Issues

### Docker Compose Fails to Start

**Symptoms:**
- Services won't start
- Error: "Cannot start service"
- Port binding errors

**Solutions:**

1. **Check if ports are already in use:**
```bash
# Check port 3001 (backend)
sudo lsof -i :3001

# Check port 3000 (frontend)
sudo lsof -i :3000

# Kill process if needed
sudo kill -9 <PID>
```

2. **Verify Docker is running:**
```bash
docker ps
docker-compose version
```

3. **Check environment file exists:**
```bash
ls -la .env
cat .env  # Verify contents (hide secrets!)
```

4. **View detailed error logs:**
```bash
docker-compose -f docker-compose.prod.yml up
# (without -d flag to see output)
```

### Permission Denied Errors

**Symptoms:**
- "Permission denied" when accessing files
- Cannot write to database
- Docker socket errors

**Solutions:**

1. **Fix data directory permissions:**
```bash
sudo chown -R $USER:$USER ./backend/data
chmod 755 ./backend/data
```

2. **Add user to docker group:**
```bash
sudo usermod -aG docker $USER
newgrp docker
```

3. **Fix Docker socket permissions:**
```bash
sudo chmod 666 /var/run/docker.sock
```

### Missing Environment Variables

**Symptoms:**
- "Environment variable not set" errors
- Application crashes on startup
- OAuth errors

**Solutions:**

1. **Verify .env file:**
```bash
# Check required variables
grep -E "GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|SESSION_SECRET" .env
```

2. **Generate missing secrets:**
```bash
# Generate session secret
echo "SESSION_SECRET=$(openssl rand -base64 32)" >> .env
```

3. **Copy from example:**
```bash
cp .env.example .env
nano .env  # Fill in your values
```

## Authentication Problems

### Google OAuth Not Working

**Symptoms:**
- "Redirect URI mismatch" error
- "Invalid client" error
- Can't login with Google

**Solutions:**

1. **Verify redirect URI matches exactly:**

In Google Cloud Console:
```
http://localhost:3001/auth/callback/google  (development)
https://yourdomain.com/auth/callback/google  (production)
```

In `.env`:
```env
GOOGLE_REDIRECT_URI=https://yourdomain.com/auth/callback/google
```

2. **Check OAuth credentials:**
```bash
# Verify credentials are set
docker-compose exec backend env | grep GOOGLE
```

3. **Test OAuth endpoint:**
```bash
curl http://localhost:3001/auth/login/google
# Should redirect to Google
```

4. **Clear browser cookies:**
- Clear cookies for your domain
- Try incognito/private browsing
- Test with different browser

### Session Expires Immediately

**Symptoms:**
- Logged out after page refresh
- "Unauthorized" errors
- Session cookie not persisting

**Solutions:**

1. **Check session secret is set:**
```bash
grep SESSION_SECRET .env
```

2. **Verify cookie settings:**
- Check browser allows cookies
- Ensure HTTPS in production
- Check SameSite cookie settings

3. **Check backend logs:**
```bash
docker-compose logs backend | grep -i session
```

### "This app hasn't been verified by Google"

**Symptoms:**
- Warning screen during OAuth
- "App not verified" message

**Solutions:**

For personal use:
1. Click "Advanced"
2. Click "Go to VROOM (unsafe)"
3. This is normal for self-hosted apps

For public use:
- Submit app for Google verification
- Not needed for personal self-hosting

## Database Issues

### Database Locked Error

**Symptoms:**
- "Database is locked" error
- Cannot write to database
- Application hangs on database operations

**Solutions:**

1. **Stop all services:**
```bash
docker-compose -f docker-compose.prod.yml down
```

2. **Remove lock files:**
```bash
rm -f ./backend/data/*.db-shm
rm -f ./backend/data/*.db-wal
```

3. **Check for multiple processes:**
```bash
# Ensure no other processes are accessing the database
lsof ./backend/data/vroom.db
```

4. **Restart services:**
```bash
docker-compose -f docker-compose.prod.yml up -d
```

### Database Corruption

**Symptoms:**
- "Database disk image is malformed"
- Cannot read data
- Application crashes on startup

**Solutions:**

1. **Check database integrity:**
```bash
docker-compose exec backend sqlite3 /app/data/vroom.db "PRAGMA integrity_check;"
```

2. **Restore from backup:**
```bash
# Stop services
docker-compose down

# Restore from backup
cp ./backups/vroom-backup-latest.db ./backend/data/vroom.db

# Restart
docker-compose up -d
```

3. **Restore from Google Sheets:**
- Login to VROOM
- Go to Settings → Backup
- Click "Restore from Google Sheets"

### Cannot Initialize Database

**Symptoms:**
- "Cannot create table" errors
- Migration failures
- Empty database

**Solutions:**

1. **Run database initialization:**
```bash
docker-compose exec backend bun run db:init
```

2. **Check database file permissions:**
```bash
ls -la ./backend/data/vroom.db
chmod 644 ./backend/data/vroom.db
```

3. **Delete and recreate database:**
```bash
# Backup first!
cp ./backend/data/vroom.db ./backend/data/vroom.db.backup

# Remove database
rm ./backend/data/vroom.db

# Restart to recreate
docker-compose restart backend
```

## Google Integration

### Google Sheets Sync Failing

**Symptoms:**
- "Failed to sync" error
- Backup not working
- Cannot access Google Sheets

**Solutions:**

1. **Check Google Drive API is enabled:**
- Go to Google Cloud Console
- APIs & Services → Library
- Search "Google Drive API"
- Ensure it's enabled

2. **Verify user permissions:**
- User must grant Drive/Sheets access
- Re-authenticate if needed
- Check OAuth scopes include Drive access

3. **Check API quotas:**
- Go to Google Cloud Console
- APIs & Services → Dashboard
- Check if quota is exceeded

4. **Test API connectivity:**
```bash
# Check backend can reach Google APIs
docker-compose exec backend curl https://www.googleapis.com/drive/v3/about
```

### Cannot Create Google Drive Folder

**Symptoms:**
- "Failed to create folder" error
- Backup folder not appearing
- Permission denied

**Solutions:**

1. **Re-authorize Google Drive access:**
- Go to Settings → Backup
- Click "Disconnect Google Drive"
- Click "Connect Google Drive"
- Grant all requested permissions

2. **Check OAuth scopes:**
Ensure OAuth consent screen includes:
- `https://www.googleapis.com/auth/drive.file`
- `https://www.googleapis.com/auth/spreadsheets`

3. **Manual folder creation:**
- Create "VROOM Car Tracker" folder in Google Drive
- Share folder ID with VROOM in settings

### Google Sheets Data Not Updating

**Symptoms:**
- Spreadsheet shows old data
- Changes not syncing
- Sync status shows "Never synced"

**Solutions:**

1. **Trigger manual sync:**
- Go to Settings → Backup
- Click "Sync Now"
- Wait for completion

2. **Check sync settings:**
- Verify auto-sync is enabled
- Check inactivity delay setting
- Ensure backend is running

3. **Check spreadsheet permissions:**
- Open Google Sheet
- Verify you have edit access
- Check if sheet is locked

## Performance Issues

### Slow Application Response

**Symptoms:**
- Pages load slowly
- API requests timeout
- Laggy interface

**Solutions:**

1. **Check container resources:**
```bash
docker stats vroom-backend vroom-frontend
```

2. **Increase container memory:**
Edit `docker-compose.prod.yml`:
```yaml
services:
  backend:
    mem_limit: 1g
    cpus: 1.0
```

3. **Check database size:**
```bash
du -sh ./backend/data/vroom.db
```

4. **Optimize database:**
```bash
docker-compose exec backend sqlite3 /app/data/vroom.db "VACUUM;"
```

### High Memory Usage

**Symptoms:**
- Container using excessive RAM
- System running out of memory
- OOM (Out of Memory) errors

**Solutions:**

1. **Restart services:**
```bash
docker-compose restart
```

2. **Set memory limits:**
```yaml
# In docker-compose.prod.yml
services:
  backend:
    mem_limit: 512m
    mem_reservation: 256m
```

3. **Check for memory leaks:**
```bash
# Monitor memory over time
watch -n 5 docker stats --no-stream
```

### Database Growing Too Large

**Symptoms:**
- Database file > 100MB
- Slow queries
- Disk space issues

**Solutions:**

1. **Vacuum database:**
```bash
docker-compose exec backend sqlite3 /app/data/vroom.db "VACUUM;"
```

2. **Archive old data:**
- Export old expenses to CSV
- Delete expenses older than X years
- Keep backups

3. **Check for orphaned data:**
```bash
docker-compose exec backend bun run db:cleanup
```

## Network and Connectivity

### Cannot Access Application Remotely

**Symptoms:**
- Works on localhost but not remotely
- Connection refused from other devices
- Timeout errors

**Solutions:**

1. **Check firewall rules:**
```bash
# Ubuntu/Debian
sudo ufw status
sudo ufw allow 3000/tcp
sudo ufw allow 3001/tcp

# Check if ports are listening
sudo netstat -tlnp | grep -E '3000|3001'
```

2. **Verify Docker port binding:**
```bash
docker-compose ps
# Should show 0.0.0.0:3000 and 0.0.0.0:3001
```

3. **Check router port forwarding:**
- Forward ports 80/443 to your server
- Set up static IP for server
- Configure DNS/Dynamic DNS

### CORS Errors

**Symptoms:**
- "CORS policy" errors in browser console
- API requests blocked
- Cross-origin errors

**Solutions:**

1. **Update CORS origins:**
```env
# In .env
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

2. **Check frontend API URL:**
```env
# In frontend .env
PUBLIC_API_URL=https://api.yourdomain.com
```

3. **Restart backend:**
```bash
docker-compose restart backend
```

### SSL/TLS Certificate Issues

**Symptoms:**
- "Not secure" warning
- Certificate errors
- HTTPS not working

**Solutions:**

1. **Check certificate validity:**
```bash
openssl s_client -connect yourdomain.com:443 -servername yourdomain.com
```

2. **Renew Let's Encrypt certificate:**
```bash
sudo certbot renew
sudo systemctl reload nginx
```

3. **Verify reverse proxy configuration:**
```bash
sudo nginx -t
sudo systemctl status nginx
```

## Docker Issues

### Container Keeps Restarting

**Symptoms:**
- Container in restart loop
- "Restarting" status
- Application unavailable

**Solutions:**

1. **Check container logs:**
```bash
docker-compose logs backend
docker-compose logs frontend
```

2. **Check health status:**
```bash
docker-compose ps
docker inspect vroom-backend | grep -A 10 Health
```

3. **Disable restart policy temporarily:**
```yaml
# In docker-compose.prod.yml
services:
  backend:
    restart: "no"  # Temporarily disable
```

### Cannot Pull Docker Images

**Symptoms:**
- "Image not found" error
- Pull timeout
- Authentication errors

**Solutions:**

1. **Check Docker Hub connectivity:**
```bash
docker pull hello-world
```

2. **Login to GitHub Container Registry:**
```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
```

3. **Use alternative registry:**
```bash
# Pull from Docker Hub instead
docker pull username/vroom-backend:latest
```

### Disk Space Issues

**Symptoms:**
- "No space left on device"
- Cannot create containers
- Build failures

**Solutions:**

1. **Check disk usage:**
```bash
df -h
docker system df
```

2. **Clean up Docker:**
```bash
# Remove unused images
docker image prune -a

# Remove unused volumes
docker volume prune

# Remove everything unused
docker system prune -a --volumes
```

3. **Move Docker data directory:**
```bash
# Stop Docker
sudo systemctl stop docker

# Move data
sudo mv /var/lib/docker /new/location/docker

# Update Docker config
sudo nano /etc/docker/daemon.json
# Add: {"data-root": "/new/location/docker"}

# Start Docker
sudo systemctl start docker
```

## FAQ

### How do I reset my password?

VROOM uses Google OAuth - there's no password to reset. Just login with your Google account.

### Can I use multiple Google accounts?

Yes, each Google account creates a separate user. Data is not shared between accounts.

### How do I backup my data?

1. **Automatic**: Enable Google Sheets sync in Settings
2. **Manual**: Copy `./backend/data/vroom.db` file
3. **Export**: Use the export feature to download JSON/CSV

### Can I import data from another app?

Yes, use the import feature:
1. Export data from other app as CSV
2. Format according to VROOM template
3. Go to Settings → Import
4. Upload CSV file

### How do I share a vehicle with family?

1. Go to vehicle details
2. Click "Share Vehicle"
3. Enter family member's email (must have VROOM account)
4. Select permission level (view or edit)
5. Send invitation

### Is my data secure?

- Data stored locally on your server
- Encrypted HTTPS connections
- Google OAuth for authentication
- Optional Google Sheets backup (encrypted in transit)
- You control all data

### Can I use without Google Sheets?

Yes, Google Sheets is optional. The app works fully with just SQLite database.

### How do I update VROOM?

```bash
# Pull latest images
docker-compose pull

# Restart with new images
docker-compose up -d
```

Or enable Watchtower for automatic updates.

### What if I lose my server?

If you enabled Google Sheets backup:
1. Set up new VROOM instance
2. Login with same Google account
3. Go to Settings → Backup
4. Click "Restore from Google Sheets"

### Can I run VROOM on Raspberry Pi?

Yes! VROOM works great on Raspberry Pi 4 with 2GB+ RAM.

### How much does it cost to run?

- **Self-hosted**: Free (electricity + hardware you own)
- **VPS**: $5-10/month
- **Oracle Cloud**: Free forever
- **Google APIs**: Free (within generous quotas)

### Can I customize VROOM?

Yes! VROOM is open source. Fork the repository and modify as needed.

### How do I get help?

1. Check this troubleshooting guide
2. Search [GitHub Issues](https://github.com/your-username/vroom/issues)
3. Ask in [GitHub Discussions](https://github.com/your-username/vroom/discussions)
4. Open a new issue with logs and details

## Still Having Issues?

If you're still experiencing problems:

1. **Collect information:**
   - Error messages
   - Container logs
   - Environment (OS, Docker version)
   - Steps to reproduce

2. **Check logs:**
```bash
# Backend logs
docker-compose logs backend > backend-logs.txt

# Frontend logs
docker-compose logs frontend > frontend-logs.txt

# System info
docker version > system-info.txt
docker-compose version >> system-info.txt
```

3. **Open an issue:**
   - Go to [GitHub Issues](https://github.com/your-username/vroom/issues)
   - Click "New Issue"
   - Use the bug report template
   - Include logs (remove sensitive data!)
   - Describe what you've tried

4. **Community support:**
   - Join [GitHub Discussions](https://github.com/your-username/vroom/discussions)
   - Share your setup
   - Help others with similar issues

## Useful Commands Reference

```bash
# View logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Restart services
docker-compose restart
docker-compose restart backend

# Stop services
docker-compose down

# Start services
docker-compose up -d

# Check status
docker-compose ps

# Execute command in container
docker-compose exec backend sh

# View container stats
docker stats

# Clean up
docker system prune -a

# Backup database
docker cp vroom-backend:/app/data/vroom.db ./backup.db

# Restore database
docker cp ./backup.db vroom-backend:/app/data/vroom.db
docker-compose restart backend
```
