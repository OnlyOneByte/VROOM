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
import { logger } from './utils/logger';

logger.startup(`VROOM Backend starting on port ${CONFIG.server.port}`);
logger.startup(`Environment: ${CONFIG.env}`);

// Run migrations on startup (idempotent — only applies new migrations)
try {
  await runMigrations();
} catch (error) {
  // Log the full error for debugging but don't crash if tables already exist
  const errorMessage = error instanceof Error ? error.message : String(error);
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
  fetch: app.fetch,
  reusePort: true, // Allow port reuse for hot reload
};
