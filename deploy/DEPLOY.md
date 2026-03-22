# WebChat Deployment Guide

## Requirements
- Linux server (Ubuntu 20.04+ recommended)
- Node.js 18+
- Nginx
- PM2 (`npm install -g pm2`)
- ffmpeg (for video thumbnails): `apt install ffmpeg`

---

## First-time Setup

### 1. Clone and install
```bash
git clone https://github.com/andrewliup/webchat.git /var/www/webchat
cd /var/www/webchat
npm install --ignore-scripts
```

> `--ignore-scripts` skips native module rebuilds. All packages ship prebuilt binaries.

### 2. Run one-time avatar migration (if upgrading from older version)
```bash
node backend/scripts/migrate-avatars.js
```
This resizes any existing user profile pictures to 128×128 WebP. Safe to skip on a fresh install.

### 3. Configure environment
```bash
cp .env.example .env
# Edit .env if needed (PORT defaults to 3000)
```

### 4. Start with PM2
```bash
pm2 start backend/server.js --name webchat
pm2 save
pm2 startup   # follow the printed command to auto-start on reboot
```

---

## Nginx Setup

### 5. Copy config
```bash
cp /var/www/webchat/deploy/nginx/webchat.conf /etc/nginx/conf.d/webchat.conf
```

Edit the file and replace `your-domain.com` with your actual domain.

### 6. SSL with Let's Encrypt
```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d your-domain.com -d www.your-domain.com
```

### 7. Test and reload Nginx
```bash
nginx -t && systemctl reload nginx
```

---

## Updating (subsequent deploys)

```bash
cd /var/www/webchat
git pull
npm install --ignore-scripts
pm2 restart webchat
```

If new migration scripts were added:
```bash
node backend/scripts/migrate-avatars.js
```

---

## Key Nginx config notes

| Setting | Why |
|---|---|
| `proxy_buffering off` | Messages forwarded immediately, no delay |
| `proxy_read_timeout 86400s` on `/socket.io/` | Keeps WebSocket alive 24h, prevents reconnect drops |
| `/uploads/` with `Cache-Control: immutable` | Browser caches images/videos permanently (filenames are unique hashes) |
| `gzip on` | Compresses JS/CSS for faster first load |
| `client_max_body_size 50M` | Allows video uploads up to 50MB |

---

## Troubleshooting

**WebSocket falls back to polling (chat feels slow)**
- Check `/socket.io/` location block has `Upgrade` and `Connection "upgrade"` headers
- Verify in browser DevTools → Network → filter `socket.io` — should show one persistent WS connection, not many HTTP requests

**Images not caching**
- Confirm `/uploads/` location block is above the `location /` block in nginx config
- Check response headers in DevTools: should include `Cache-Control: public, max-age=2592000, immutable`

**Server won't start**
```bash
pm2 logs webchat   # view error output
node backend/server.js   # run directly to see startup errors
```

**Port already in use**
```bash
lsof -i :3000
kill -9 <PID>
pm2 start webchat
```
