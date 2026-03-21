# WebChat Dockerfile
# Multi-stage build for production

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY . .

# Stage 2: Production
FROM node:20-alpine AS production

# Install production dependencies only
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application
COPY --from=builder /app/backend ./backend
COPY --from=builder /app/frontend ./frontend
COPY --from=builder /app/.env.example ./.env.example

# Create necessary directories
RUN mkdir -p /app/backend/uploads /app/data && \
    chown -R node:node /app

# Switch to non-root user
USER node

# Set environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DB_PATH=/app/data/chat.db \
    UPLOAD_DIR=/app/backend/uploads

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/auth/me', (r) => process.exit(r.statusCode === 401 ? 0 : 1))"

# Start application
CMD ["node", "backend/server.js"]
