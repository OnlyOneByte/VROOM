FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun build src/index.ts --outdir ./dist --target bun

FROM oven/bun:1-alpine AS production

WORKDIR /app

RUN apk add --no-cache dumb-init

COPY --chown=bun:bun package.json bun.lock* ./
RUN bun install --production --frozen-lockfile

# dist/index.js bundles every module except bun:sqlite and node builtins, and startup migrations
# read ./drizzle, so these two are the whole runtime. Don't copy src/: it can't run without devDependencies.
COPY --chown=bun:bun --from=builder /app/dist ./dist
COPY --chown=bun:bun --from=builder /app/drizzle ./drizzle

RUN mkdir -p /app/data && chown -R bun:bun /app/data

# HOST must be reachable from outside the container and still cover loopback, which the HEALTHCHECK dials.
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    DATABASE_URL=/app/data/vroom.db

USER bun

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD bun run -e "fetch('http://localhost:3001/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]

CMD ["bun", "run", "dist/index.js"]
