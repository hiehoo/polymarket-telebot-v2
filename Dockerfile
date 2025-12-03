# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for building)
RUN npm ci

# Copy source code and configuration
COPY src/ ./src/
COPY tsconfig.json ./
COPY scripts/ ./scripts/

# Build the application
RUN npm run build

# Production dependencies stage
FROM node:18-alpine AS dependencies

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Production stage
FROM node:18-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create app user
RUN addgroup -g 1001 -S nodejs && adduser -S telebot -u 1001 -G nodejs

WORKDIR /app

# Copy built application and production dependencies
COPY --from=builder --chown=telebot:nodejs /app/dist ./dist
COPY --from=dependencies --chown=telebot:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=telebot:nodejs /app/package.json ./package.json
COPY --from=builder --chown=telebot:nodejs /app/scripts ./scripts

# Create logs directory
RUN mkdir -p logs && chown telebot:nodejs logs

# Switch to non-root user
USER telebot

# Expose port (if needed for health checks)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD ps aux | grep '[n]ode.*index.minimal.js' || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.minimal.js"]