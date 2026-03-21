# WebChat 部署文档

本指南介绍如何将 WebChat 部署到 Linux 服务器。

## 目录

1. [系统要求](#系统要求)
2. [部署方式](#部署方式)
3. [方式一：Docker 部署（推荐）](#方式一 docker-部署推荐)
4. [方式二：Systemd 部署](#方式二 systemd-部署)
5. [Nginx 反向代理配置](#nginx 反向代理配置)
6. [SSL/HTTPS 配置](#sslhttps 配置)
7. [常见问题](#常见问题)

---

## 系统要求

- **操作系统**: Ubuntu 20.04+ / Debian 11+ / CentOS 8+
- **Node.js**: 18.x 或更高版本
- **内存**: 至少 512MB RAM
- **存储**: 至少 1GB 可用空间

---

## 部署方式

### 方式一：Docker 部署（推荐）

#### 1. 安装 Docker

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# 启动 Docker
sudo systemctl enable docker
sudo systemctl start docker
```

#### 2. 使用 Docker Compose 部署

```bash
# 进入项目目录
cd /path/to/WebChat

# 复制环境变量文件
cp .env.example .env

# 编辑环境变量（可选）
nano .env

# 构建并启动
docker-compose up -d --build
```

#### 3. 查看运行状态

```bash
# 查看容器状态
docker-compose ps

# 查看日志
docker-compose logs -f webchat
```

#### 4. 停止/重启服务

```bash
# 停止
docker-compose down

# 重启
docker-compose restart

# 重新构建并启动
docker-compose up -d --build
```

---

### 方式二：Systemd 部署

#### 1. 安装 Node.js

```bash
# 使用 NodeSource 安装 Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证安装
node -v
npm -v
```

#### 2. 克隆项目

```bash
sudo mkdir -p /var/www/webchat
sudo chown $USER:$USER /var/www/webchat
cd /var/www/webchat

# 如果是 git 仓库
git clone <your-repo-url> .
# 或者直接复制文件到此目录
```

#### 3. 安装依赖

```bash
npm ci --only=production
```

#### 4. 创建应用用户

```bash
sudo useradd -r -s /bin/false -d /var/www/webchat webchat
```

#### 5. 配置环境变量

```bash
sudo mkdir -p /etc/webchat
sudo cp .env.example /etc/webchat/.env

# 生成安全的 SESSION_SECRET
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo "SESSION_SECRET=$SESSION_SECRET" | sudo tee -a /etc/webchat/.env
```

#### 6. 设置目录权限

```bash
sudo mkdir -p /var/www/webchat/backend/uploads /var/www/webchat/data
sudo chown -R webchat:webchat /var/www/webchat
sudo chmod -R 755 /var/www/webchat
sudo chmod 700 /var/www/webchat/backend/uploads /var/www/webchat/data
```

#### 7. 配置 Systemd 服务

```bash
# 复制服务文件
sudo cp deploy/systemd/webchat.service /etc/systemd/system/

# 重新加载 systemd
sudo systemctl daemon-reload

# 启用并启动服务
sudo systemctl enable webchat
sudo systemctl start webchat

# 查看状态
sudo systemctl status webchat
```

#### 8. 管理命令

```bash
# 启动
sudo systemctl start webchat

# 停止
sudo systemctl stop webchat

# 重启
sudo systemctl restart webchat

# 查看日志
sudo journalctl -u webchat -f

# 查看最近 100 行日志
sudo journalctl -u webchat -n 100
```

---

## Nginx 反向代理配置

### 1. 安装 Nginx

```bash
sudo apt-get update
sudo apt-get install -y nginx
```

### 2. 配置 Nginx

```bash
# 复制配置文件
sudo cp deploy/nginx/webchat.conf /etc/nginx/sites-available/webchat

# 编辑配置文件，修改域名
sudo nano /etc/nginx/sites-available/webchat
# 将 your-domain.com 替换为你的实际域名

# 创建软链接
sudo ln -s /etc/nginx/sites-available/webchat /etc/nginx/sites-enabled/

# 删除默认配置（可选）
sudo rm /etc/nginx/sites-enabled/default

# 测试配置
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx
```

---

## SSL/HTTPS 配置

### 使用 Let's Encrypt 获取免费证书

```bash
# 安装 Certbot
sudo apt-get install -y certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# 自动续期测试
sudo certbot renew --dry-run
```

### 证书自动续期

Certbot 会自动配置定时任务。验证定时任务：

```bash
sudo systemctl status certbot.timer
```

---

## 常见问题

### 1. 服务无法启动

```bash
# 查看系统日志
sudo journalctl -u webchat -n 50

# 检查端口占用
sudo lsof -i :3000

# 检查文件权限
ls -la /var/www/webchat
```

### 2. 数据库问题

```bash
# 数据库文件位置
ls -la /var/www/webchat/data/

# 如果是 Docker
docker exec -it webchat ls -la /app/data/
```

### 3. 文件上传失败

```bash
# 检查上传目录权限
ls -la /var/www/webchat/backend/uploads/
sudo chown -R webchat:webchat /var/www/webchat/backend/uploads
```

### 4. WebSocket 连接失败

确保 Nginx 配置中包含 WebSocket 升级头：

```nginx
location /socket.io/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

### 5. 内存不足

如果服务器内存较小，可以限制 Node.js 内存使用：

```bash
# 编辑 systemd 服务文件
sudo nano /etc/systemd/system/webchat.service

# 在 [Service] 部分添加
Environment="NODE_OPTIONS=--max-old-space-size=256"

# 重新加载
sudo systemctl daemon-reload
sudo systemctl restart webchat
```

---

## 备份与恢复

### 备份数据

```bash
# 备份数据库
cp /var/www/webchat/data/chat.db /backup/chat.db.$(date +%Y%m%d)

# 备份上传的文件
tar -czf /backup/webchat-uploads.$(date +%Y%m%d).tar.gz /var/www/webchat/backend/uploads/
```

### Docker 数据备份

```bash
# 备份数据卷
docker run --rm -v webchat_webchat-data:/data -v $(pwd):/backup alpine tar czf /backup/webchat-data.tar.gz /data
```

---

## 更新部署

### Docker 方式更新

```bash
# 拉取最新代码
git pull

# 重新构建并启动
docker-compose down
docker-compose up -d --build
```

### Systemd 方式更新

```bash
# 进入应用目录
cd /var/www/webchat

# 拉取最新代码
git pull

# 安装依赖
npm ci --only=production

# 重启服务
sudo systemctl restart webchat
```

---

## 安全建议

1. **修改默认密码**: 确保修改 `.env` 中的 `SESSION_SECRET`
2. **防火墙配置**: 只开放必要的端口（80, 443）
3. **定期更新**: 保持系统和 Node.js 版本更新
4. **日志监控**: 定期检查应用和系统日志
5. **数据备份**: 定期备份数据库和上传文件

---

## 技术支持

如有问题，请查看：
- 应用日志：`journalctl -u webchat -f`
- Nginx 日志：`/var/log/nginx/`
- Docker 日志：`docker-compose logs -f`
