# Multi-stage Dockerfile for Bun backend
# Stage 1: Dependencies and build
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Generate Drizzle types
RUN bun run db:generate

# Build the application
RUN bun build src/index.ts --outdir ./dist --target bun

# Stage 2: Production runtime
FROM oven/bun:1-alpine AS production

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# The bun user already exists in the base image, so we don't need to create it

# Copy package files and install production dependencies only
COPY --chown=bun:bun package.json bun.lock* ./
RUN bun install --production --frozen-lockfile

# Copy built application from builder stage
COPY --chown=bun:bun --from=builder /app/dist ./dist
COPY --chown=bun:bun --from=builder /app/drizzle ./drizzle
COPY --chown=bun:bun --from=builder /app/src/db ./src/db
COPY --chown=bun:bun drizzle.config.ts ./

# Create data directory for SQLite database
RUN mkdir -p /app/data && chown -R bun:bun /app/data

# Set environment variables
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    DATABASE_URL=/app/data/vroom.db

# Switch to non-root user
USER bun

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD bun run -e "fetch('http://localhost:3001/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["bun", "run", "dist/index.js"]
