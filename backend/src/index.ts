/**
 * Server entry point — imports the pure Hono `app` and adds runtime side effects:
 * startup migrations, WAL checkpoint loop, background sync worker, graceful
 * shutdown, and the Bun server export. The app construction itself lives in
 * `app.ts` (side-effect-free) so tests can drive it in-process.
 */

import { startSyncWorker, stopSyncWorker } from './api/providers/sync-worker';
import { app } from './app';
import './api/sync/init';
import { CONFIG } from './config';
import { checkpointWAL, forceCheckpointWAL, runMigrations } from './db/connection';
import { extractErrorMessage } from './utils/error-handling';
import { logger } from './utils/logger';

logger.startup(`VROOM Backend starting on ${CONFIG.server.host}:${CONFIG.server.port}`);
logger.startup(`Environment: ${CONFIG.env}`);

// Name HOST when HOST is the problem. Bun's own failure for an address this machine does not own
// is `EADDRINUSE — Failed to start server. Is port <PORT> in use?`, which sends the operator
// hunting a port collision that does not exist. Probing port 0 isolates the address: an ephemeral
// port is never occupied, so a throw here can only be the host. The probe is released immediately
// and never touches the configured port, so a genuine port conflict still surfaces as Bun's own
// port error below. Runs before migrations — an instance that cannot serve should not touch the DB.
try {
  const probe = Bun.serve({
    hostname: CONFIG.server.host,
    port: 0,
    fetch: () => new Response(null, { status: 204 }),
  });
  await probe.stop(true);
} catch {
  logger.error(
    `Cannot bind HOST=${CONFIG.server.host} — this machine has no interface with that address. ` +
      'Use 0.0.0.0 (every interface, what a container needs), 127.0.0.1 (loopback only), or an ' +
      'address this host actually owns.'
  );
  process.exit(1);
}

// Run migrations on startup (idempotent — only applies new migrations)
try {
  await runMigrations();
} catch (error) {
  // Log the full error for debugging but don't crash if tables already exist
  const errorMessage = extractErrorMessage(error);
  if (errorMessage.includes('already exists')) {
    logger.info('Database tables already exist, skipping migrations');
  } else {
    logger.error('Failed to run migrations on startup', {
      error,
      message: errorMessage,
    });
    process.exit(1);
  }
}

const checkpointInterval = setInterval(
  () => {
    checkpointWAL();
  },
  CONFIG.env === 'development'
    ? CONFIG.database.checkpointIntervalDev
    : CONFIG.database.checkpointIntervalProd
);

// Force checkpoint on startup to ensure any previous data is persisted
forceCheckpointWAL();

// Start background sync worker (polls pending photo_refs for multi-provider fan-out)
startSyncWorker();

// Graceful shutdown handler
const shutdown = (signal: string) => {
  logger.shutdown(`Received ${signal}, shutting down gracefully...`);

  // Stop sync worker
  stopSyncWorker();

  // Clear checkpoint interval
  clearInterval(checkpointInterval);

  // Final forced checkpoint before shutdown to ensure all data is persisted
  forceCheckpointWAL();

  process.exit(0);
};

// Register signal handlers for graceful shutdown
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default {
  port: CONFIG.server.port,
  // Bun binds every interface unless given a hostname. HOST must be passed through or an
  // operator who sets HOST=127.0.0.1 to keep the API private behind a reverse proxy still gets
  // a publicly reachable port, with nothing in the logs to say so. Containers set HOST=0.0.0.0
  // (Dockerfile + both example stacks) because a loopback bind is unreachable from outside the
  // container.
  hostname: CONFIG.server.host,
  fetch: app.fetch,
  reusePort: true, // Allow port reuse for hot reload
};
