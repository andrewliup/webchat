#!/bin/bash
# WebChat Linux Deployment Script
# Usage: sudo ./deploy.sh [domain-name]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="webchat"
APP_USER="webchat"
APP_DIR="/var/www/webchat"
ENV_FILE="/etc/webchat/.env"
SYSTEMD_SERVICE="/etc/systemd/system/webchat.service"

echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}   WebChat Deployment Script${NC}"
echo -e "${GREEN}=====================================${NC}"

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}This script must be run as root (use sudo)${NC}"
   exit 1
fi

# Optional: Get domain name for SSL
DOMAIN=""
if [ -n "$1" ]; then
    DOMAIN="$1"
    echo -e "${YELLOW}Domain provided: $DOMAIN${NC}"
fi

# Step 1: Install dependencies
echo -e "${YELLOW}[1/8] Installing dependencies...${NC}"
apt-get update
apt-get install -y nodejs npm nginx certbot python3-certbot-nginx git curl

# Verify Node.js version (should be 18+)
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${YELLOW}Node.js version is old ($NODE_VERSION). Installing Node.js 20.x...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

echo -e "Node.js version: $(node -v)"
echo -e "npm version: $(npm -v)"

# Step 2: Create application user
echo -e "${YELLOW}[2/8] Creating application user...${NC}"
if ! id -u "$APP_USER" > /dev/null 2>&1; then
    useradd -r -s /bin/false -d "$APP_DIR" "$APP_USER"
    echo -e "${GREEN}Created user: $APP_USER${NC}"
else
    echo -e "${GREEN}User already exists: $APP_USER${NC}"
fi

# Step 3: Clone or update application
echo -e "${YELLOW}[3/8] Setting up application...${NC}"
if [ -d "$APP_DIR" ]; then
    echo -e "${YELLOW}Application directory exists. Pulling latest changes...${NC}"
    cd "$APP_DIR"
    git pull || true
else
    echo -e "${YELLOW}Cloning application...${NC}"
    mkdir -p "$APP_DIR"
    # If you have a git repo, clone it:
    # git clone <your-repo-url> "$APP_DIR"
    # For now, we'll assume files are copied manually
    echo -e "${YELLOW}Please copy application files to $APP_DIR${NC}"
fi

# Step 4: Install dependencies
echo -e "${YELLOW}[4/8] Installing Node.js dependencies...${NC}"
cd "$APP_DIR"
npm ci --only=production

# Step 5: Create directories and set permissions
echo -e "${YELLOW}[5/8] Setting up directories and permissions...${NC}"
mkdir -p "$APP_DIR/backend/uploads" "$APP_DIR/data"
mkdir -p "$(dirname $ENV_FILE)"

chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod -R 755 "$APP_DIR"
chmod 700 "$APP_DIR/backend/uploads" "$APP_DIR/data"

# Step 6: Create environment file
echo -e "${YELLOW}[6/8] Creating environment file...${NC}"
if [ ! -f "$ENV_FILE" ]; then
    SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    cat > "$ENV_FILE" << EOF
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
SESSION_SECRET=$SESSION_SECRET
DB_PATH=/var/www/webchat/data/chat.db
UPLOAD_DIR=/var/www/webchat/backend/uploads
EOF
    chmod 600 "$ENV_FILE"
    echo -e "${GREEN}Created environment file: $ENV_FILE${NC}"
else
    echo -e "${GREEN}Environment file already exists${NC}"
fi

# Step 7: Setup systemd service
echo -e "${YELLOW}[7/8] Setting up systemd service...${NC}"
cp "$APP_DIR/deploy/systemd/webchat.service" "$SYSTEMD_SERVICE"

# Reload systemd and enable service
systemctl daemon-reload
systemctl enable webchat
systemctl start webchat

# Wait for service to start
sleep 2
systemctl status webchat --no-pager

# Step 8: Configure Nginx (optional)
echo -e "${YELLOW}[8/8] Configuring Nginx...${NC}"
if [ -n "$DOMAIN" ]; then
    # Update nginx config with actual domain
    sed "s/your-domain.com/$DOMAIN/g" "$APP_DIR/deploy/nginx/webchat.conf" > "/etc/nginx/sites-available/$APP_NAME"
    ln -sf "/etc/nginx/sites-available/$APP_NAME" "/etc/nginx/sites-enabled/$APP_NAME"
    rm -f /etc/nginx/sites-enabled/default

    # Test nginx configuration
    nginx -t

    # Get SSL certificate
    echo -e "${YELLOW}Obtaining SSL certificate with Let's Encrypt...${NC}"
    certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos --email admin@"$DOMAIN"

    systemctl restart nginx
    echo -e "${GREEN}Nginx configured with SSL for $DOMAIN${NC}"
else
    echo -e "${YELLOW}No domain provided. Skipping Nginx SSL setup.${NC}"
    echo -e "${YELLOW}WebChat will be available at http://$(hostname -I | awk '{print $1}'):3000${NC}"
fi

# Final status
echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}   Deployment Complete!${NC}"
echo -e "${GREEN}=====================================${NC}"
echo -e "WebChat should be running at:"
if [ -n "$DOMAIN" ]; then
    echo -e "  ${GREEN}https://$DOMAIN${NC}"
fi
echo -e "  ${GREEN}http://$(hostname -I | awk '{print $1}'):3000${NC}"
echo ""
echo -e "Useful commands:"
echo -e "  ${YELLOW}systemctl status webchat${NC}     - Check service status"
echo -e "  ${YELLOW}systemctl restart webchat${NC}    - Restart service"
echo -e "  ${YELLOW}journalctl -u webchat -f${NC}     - View logs"
echo -e "  ${YELLOW}systemctl stop webchat${NC}       - Stop service"
