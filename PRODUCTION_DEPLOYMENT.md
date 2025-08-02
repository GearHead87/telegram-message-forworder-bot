# Production Deployment Guide - Telegram Marketing Bot

## 🚀 VPS Production Deployment

This guide covers deploying the Telegram Marketing Bot to a VPS for 24/7 operation with high availability and monitoring.

## 📋 Prerequisites

### System Requirements
- **VPS**: 2+ CPU cores, 4GB+ RAM, 20GB+ storage
- **OS**: Ubuntu 20.04+ or CentOS 8+
- **Node.js**: 20.x LTS
- **Docker**: 24.x+ (recommended)
- **Domain**: HTTPS-enabled domain for webhook

### Required Services
- MongoDB (local or cloud)
- Reverse proxy (Nginx recommended)
- SSL certificate (Let's Encrypt recommended)

## 🔧 Quick Start with Docker

### 1. Clone and Setup
```bash
git clone <your-repo>
cd Telegram-Marketing-Bot

# Copy environment template
cp env.production.template .env.production

# Edit with your configuration
nano .env.production
```

### 2. Configure Environment
```bash
# Required variables in .env.production
TELEGRAM_BOT_TOKEN=your_bot_token_here
MONGODB_URI=mongodb://username:password@host:27017/database
DATABASE_NAME=telegram_marketing_bot
USER_COLLECTION_NAME=users
NODE_ENV=production
PORT=3000
SERVER_URL=https://your-domain.com
```

### 3. Deploy with Docker Compose
```bash
# Build and start services
docker-compose -f docker-compose.prod.yml --env-file .env.production up -d

# Check status
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f telegram-bot
```

## 🏗️ Manual VPS Setup

### 1. System Preparation
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Yarn
npm install -g yarn

# Install PM2 for process management
npm install -g pm2
```

### 2. Application Setup
```bash
# Clone repository
git clone <your-repo>
cd Telegram-Marketing-Bot

# Install dependencies
yarn install --frozen-lockfile --production

# Build application
yarn build

# Setup environment
cp env.production.template .env.production
# Edit .env.production with your configuration
```

### 3. Process Management with PM2
```bash
# Create PM2 ecosystem file
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'telegram-marketing-bot',
    script: 'build/src/start_server_prod.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_file: '.env.production',
    error_file: 'logs/err.log',
    out_file: 'logs/out.log',
    log_file: 'logs/combined.log',
    time: true,
    max_restarts: 10,
    min_uptime: '10s',
    max_memory_restart: '1G'
  }]
}
EOF

# Start with PM2
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## 🌐 Nginx Configuration

### 1. Install Nginx
```bash
sudo apt install nginx
sudo systemctl enable nginx
```

### 2. Configure Nginx
```bash
sudo nano /etc/nginx/sites-available/telegram-bot
```

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_connect_timeout 30s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }

    location /health {
        proxy_pass http://localhost:3000/health;
        access_log off;
    }
}
```

### 3. Enable Site
```bash
sudo ln -s /etc/nginx/sites-available/telegram-bot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 🔒 SSL Setup with Let's Encrypt

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

## 🔧 Webhook Setup

After deployment, set the webhook:

```bash
# Set webhook
curl -X POST https://your-domain.com/set-webhook \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-domain.com/webhook"}'

# Verify webhook
curl https://your-domain.com/webhook-info
```

## 📊 Monitoring & Maintenance

### Health Checks
```bash
# Application health
curl https://your-domain.com/health

# Database health
curl https://your-domain.com/ready

# Bot status
curl https://your-domain.com/bot-info
```

### Log Management
```bash
# PM2 logs
pm2 logs telegram-marketing-bot

# Application logs
tail -f logs/combined.log

# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### Performance Monitoring
```bash
# PM2 monitoring
pm2 monit

# System resources
htop
df -h
free -h
```

## 🔄 Updates & Maintenance

### Application Updates
```bash
# Pull latest code
git pull origin main

# Install dependencies
yarn install --frozen-lockfile --production

# Build application
yarn build

# Restart with zero downtime
pm2 reload telegram-marketing-bot
```

### Database Maintenance
```bash
# Backup MongoDB
mongodump --uri="your_mongodb_uri" --out=backup-$(date +%Y%m%d)

# Restore MongoDB
mongorestore --uri="your_mongodb_uri" backup-folder/
```

## 🚨 Troubleshooting

### Common Issues

1. **Bot not responding**
   ```bash
   pm2 logs telegram-marketing-bot
   curl https://your-domain.com/health
   ```

2. **Database connection issues**
   ```bash
   # Check MongoDB status
   sudo systemctl status mongod
   # Test connection
   mongosh "your_mongodb_uri"
   ```

3. **High memory usage**
   ```bash
   pm2 reload telegram-marketing-bot
   # Check for memory leaks in logs
   ```

4. **SSL certificate issues**
   ```bash
   sudo certbot certificates
   sudo certbot renew --dry-run
   ```

### Performance Optimization

1. **Enable gzip compression** in Nginx
2. **Configure MongoDB indexes** for better query performance
3. **Set up log rotation** to prevent disk space issues
4. **Monitor with tools** like New Relic or DataDog

## 📞 Support

For production support:
- Check logs first: `pm2 logs` or `docker-compose logs`
- Verify health endpoints
- Review configuration files
- Check system resources

## 🔐 Security Checklist

- ✅ Use HTTPS only
- ✅ Strong database passwords
- ✅ Firewall configured (ports 22, 80, 443 only)
- ✅ Regular security updates
- ✅ Environment variables secured
- ✅ Log rotation configured
- ✅ Backup strategy implemented
- ✅ Monitoring alerts set up 