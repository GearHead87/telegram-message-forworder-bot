# Multi-stage production-ready Dockerfile for Telegram Marketing Bot

# Build stage
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies with yarn for better performance
RUN yarn install --frozen-lockfile --production=false

# Copy source code
COPY . .

# Build the application
RUN yarn build

# Remove dev dependencies to reduce size
RUN yarn install --frozen-lockfile --production=true && yarn cache clean

# Production stage
FROM node:20-alpine AS production

# Install security updates and required packages
RUN apk update && apk upgrade && \
    apk add --no-cache \
    dumb-init \
    tzdata \
    curl && \
    rm -rf /var/cache/apk/*

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S botuser -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Copy built application from builder stage
COPY --from=builder --chown=botuser:nodejs /app/build ./build
COPY --from=builder --chown=botuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=botuser:nodejs /app/package.json ./package.json

# Create logs directory
RUN mkdir -p /app/logs && chown botuser:nodejs /app/logs

# Create Let's Encrypt directory and acme.json file for HTTPS certificates
RUN rm -rf /letsencrypt && \
    mkdir /letsencrypt && \
    touch /letsencrypt/acme.json && \
    chmod 600 /letsencrypt/acme.json

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV LOG_LEVEL=info

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Expose port
EXPOSE 3000

# Switch to non-root user
USER botuser

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "build/src/start_server_prod.js"]

# Metadata
LABEL maintainer="Telegram Marketing Bot Team"
LABEL version="1.0.0"
LABEL description="Production-ready Telegram Marketing Bot with clustering support" 