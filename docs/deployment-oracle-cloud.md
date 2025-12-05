# Oracle Cloud Deployment Guide

Deploy PolyBot for **FREE forever** on Oracle Cloud Infrastructure (OCI).

## What You Get (Free Tier)
- 2x AMD VMs (1GB RAM each) or 4x ARM VMs (6GB RAM each)
- 200GB block storage
- 10TB/month outbound data
- **Never expires** (unlike AWS/GCP free tiers)

---

## Step 1: Create Oracle Cloud Account

1. Go to [cloud.oracle.com](https://cloud.oracle.com)
2. Click "Sign Up for Free"
3. Use a real credit card (won't be charged, just verification)
4. Select your home region (closest to you)
5. Wait for account activation (usually instant)

---

## Step 2: Create a VM Instance

1. Go to **Compute → Instances → Create Instance**

2. **Name**: `polybot`

3. **Image and Shape**:
   - Click "Edit"
   - Image: **Oracle Linux 8** or **Ubuntu 22.04**
   - Shape: Click "Change Shape"
     - Select **Ampere** (ARM) → **VM.Standard.A1.Flex**
     - OCPUs: 2, Memory: 12GB (still free!)

4. **Networking**:
   - Create new VCN or use existing
   - Assign public IPv4 address: **Yes**

5. **Add SSH Keys**:
   - Generate a key pair or upload your public key
   - **SAVE THE PRIVATE KEY** - you'll need it to SSH

6. Click **Create**

---

## Step 3: Configure Security Rules

1. Go to **Networking → Virtual Cloud Networks**
2. Click your VCN → **Security Lists** → Default Security List
3. Add **Ingress Rules**:

| Source CIDR | Protocol | Destination Port | Description |
|-------------|----------|------------------|-------------|
| 0.0.0.0/0   | TCP      | 22               | SSH         |
| 0.0.0.0/0   | TCP      | 80               | HTTP (optional) |
| 0.0.0.0/0   | TCP      | 443              | HTTPS (optional) |

(Bot doesn't need HTTP ports, but useful for health checks)

---

## Step 4: Connect to Your VM

```bash
# SSH into your VM
ssh -i /path/to/your-private-key ubuntu@<YOUR_VM_PUBLIC_IP>

# Or for Oracle Linux
ssh -i /path/to/your-private-key opc@<YOUR_VM_PUBLIC_IP>
```

---

## Step 5: Install Docker

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sudo sh

# Add user to docker group
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Logout and login again for group changes
exit
```

SSH back in after logging out.

---

## Step 6: Clone and Deploy

```bash
# Clone your repository
git clone https://github.com/YOUR_USERNAME/PolyBot.git
cd PolyBot

# Create environment file
cp .env.example .env
nano .env
```

Edit `.env` with your credentials:
```env
# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token_here

# Polymarket API
POLYMARKET_API_KEY=your_api_key_here
POLYMARKET_API_SECRET=your_api_secret_here

# Database (Docker internal)
DATABASE_URL=postgresql://polybot:polybot_secure_password@postgres:5432/polybot

# Redis (Docker internal)
REDIS_URL=redis://redis:6379

# Node environment
NODE_ENV=production
LOG_LEVEL=info
```

---

## Step 7: Start the Bot

```bash
# Build and start all services
docker-compose up -d --build

# Check logs
docker-compose logs -f polymarket-telebot

# Check status
docker-compose ps
```

---

## Step 8: Set Up Auto-Start on Reboot

```bash
# Enable Docker to start on boot
sudo systemctl enable docker

# Create systemd service for docker-compose
sudo nano /etc/systemd/system/polybot.service
```

Add this content:
```ini
[Unit]
Description=PolyBot Docker Compose
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/ubuntu/PolyBot
ExecStart=/usr/local/bin/docker-compose up -d
ExecStop=/usr/local/bin/docker-compose down
User=ubuntu

[Install]
WantedBy=multi-user.target
```

Enable it:
```bash
sudo systemctl enable polybot
sudo systemctl start polybot
```

---

## Step 9: Set Up GitHub Auto-Deploy (Optional)

Create a simple deploy script:

```bash
nano ~/deploy.sh
```

```bash
#!/bin/bash
cd /home/ubuntu/PolyBot
git pull origin main
docker-compose down
docker-compose up -d --build
docker-compose logs -f --tail=50 polymarket-telebot
```

```bash
chmod +x ~/deploy.sh
```

### Option A: Manual Deploy
SSH in and run `~/deploy.sh`

### Option B: GitHub Actions Auto-Deploy

Add to your repo: `.github/workflows/deploy.yml`

```yaml
name: Deploy to Oracle Cloud

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.ORACLE_HOST }}
          username: ${{ secrets.ORACLE_USER }}
          key: ${{ secrets.ORACLE_SSH_KEY }}
          script: |
            cd /home/ubuntu/PolyBot
            git pull origin main
            docker-compose down
            docker-compose up -d --build
```

Add these secrets in GitHub repo settings:
- `ORACLE_HOST`: Your VM's public IP
- `ORACLE_USER`: `ubuntu` or `opc`
- `ORACLE_SSH_KEY`: Your private SSH key

---

## Maintenance Commands

```bash
# View logs
docker-compose logs -f polymarket-telebot

# Restart bot
docker-compose restart polymarket-telebot

# Update and redeploy
git pull && docker-compose up -d --build

# Check resource usage
docker stats

# Backup database
docker exec polymarket-postgres pg_dump -U polybot polybot > backup.sql
```

---

## Troubleshooting

### Can't connect via SSH
- Check security list has port 22 open
- Verify you're using correct private key
- Check VM is running in OCI console

### Bot not starting
```bash
docker-compose logs polymarket-telebot
```

### Redis/Postgres connection issues
```bash
# Check if services are running
docker-compose ps

# Restart all services
docker-compose down && docker-compose up -d
```

### Out of memory
- ARM VMs have 12GB RAM, should be plenty
- Check with `free -h` and `docker stats`

---

## Cost Summary

| Resource | Free Tier | Your Usage |
|----------|-----------|------------|
| ARM VM | 4 OCPUs, 24GB RAM | 2 OCPUs, 12GB |
| Block Storage | 200GB | ~20GB |
| Outbound Data | 10TB/month | <1GB/month |
| **Total** | **$0/month** | **$0/month** |

Your bot will run **completely free forever** on Oracle Cloud!
