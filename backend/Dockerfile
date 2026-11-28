FROM oven/bun:1.3.14 AS builder

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun build src/index.ts src/scripts/rotate-provider-keys.ts --outdir ./dist --target bun --external tesseract.js --external @tesseract.js-data/eng

FROM oven/bun:1.3.14-alpine AS production

WORKDIR /app

RUN apk upgrade --no-cache && apk add --no-cache dumb-init

COPY --chown=bun:bun package.json bun.lock* ./
RUN bun install --production --frozen-lockfile && \
    rm -f node_modules/tesseract.js-core/*.wasm.js && \
    rm -rf node_modules/@tesseract.js-data/eng/4.0.0

# dist/index.js bundles every module except bun:sqlite, node builtins and the OCR engine (which
# runs its own worker script and model files from node_modules), and startup migrations read
# ./drizzle (./drizzle-pg on Postgres), so these and node_modules are the whole runtime. dist/scripts/rotate-provider-keys.js is the
# key rotation command, bundled the same way. Don't copy src/: it can't run without devDependencies.
COPY --chown=bun:bun --from=builder /app/dist ./dist
COPY --chown=bun:bun --from=builder /app/drizzle ./drizzle
COPY --chown=bun:bun --from=builder /app/drizzle-pg ./drizzle-pg

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
