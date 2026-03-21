# WebChat 快速部署指南

## 快速开始

### 方式一：Docker Compose（最简单）

```bash
# 1. 克隆项目
git clone <your-repo-url> WebChat
cd WebChat

# 2. 复制环境变量
cp .env.example .env

# 3. 启动服务
docker-compose up -d --build

# 4. 访问应用
# http://localhost:3000
```

### 方式二：本地运行

```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器
npm run dev

# 3. 启动生产服务器
npm run prod
```

---

## 部署到 Linux 服务器

### 使用自动化脚本

```bash
# 上传项目到服务器后
cd /path/to/WebChat

# 运行部署脚本（需要 root 权限）
sudo bash deploy/deploy.sh your-domain.com
```

### 手动部署

详细步骤请查看 [DEPLOYMENT.md](DEPLOYMENT.md)

---

## 目录结构

```
WebChat/
├── backend/           # 后端代码
│   ├── server.js      # 主服务器
│   ├── db.js          # 数据库
│   ├── routes/        # API 路由
│   └── uploads/       # 上传文件
├── frontend/          # 前端代码
│   ├── index.html     # 主页面
│   └── app.js         # 客户端逻辑
├── deploy/            # 部署相关文件
│   ├── deploy.sh      # 部署脚本
│   ├── systemd/       # Systemd 服务配置
│   └── nginx/         # Nginx 配置
├── .env.example       # 环境变量模板
├── Dockerfile         # Docker 镜像
├── docker-compose.yml # Docker Compose 配置
└── package.json       # 项目配置
```

---

## 常用命令

### 开发

```bash
npm run dev          # 开发模式
npm run prod         # 生产模式
```

### Docker

```bash
npm run compose:up       # 启动 Docker Compose
npm run compose:down     # 停止 Docker Compose
npm run compose:logs     # 查看日志
npm run docker:build     # 构建 Docker 镜像
```

### Systemd

```bash
sudo systemctl start webchat     # 启动服务
sudo systemctl stop webchat      # 停止服务
sudo systemctl restart webchat   # 重启服务
sudo journalctl -u webchat -f    # 查看日志
```

---

## 默认配置

- **端口**: 3000
- **数据库**: SQLite (backend/chat.db)
- **会话过期**: 7 天
- **最大文件上传**: 50MB

---

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| NODE_ENV | 运行环境 | production |
| PORT | 服务端口 | 3000 |
| HOST | 监听地址 | 0.0.0.0 |
| SESSION_SECRET | 会话密钥 | (自动生成) |
| DB_PATH | 数据库路径 | ./chat.db |

---

## 安全提示

1. 部署前请修改 `.env` 中的 `SESSION_SECRET`
2. 使用 Nginx 反向代理并配置 HTTPS
3. 配置防火墙，仅开放必要端口
4. 定期备份数据库文件

---

## 更多信息

- 详细部署文档：[DEPLOYMENT.md](DEPLOYMENT.md)
- 架构说明：[ARCHITECTURE.md](ARCHITECTURE.md)
