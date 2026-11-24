import { startCommunityStatsJob, stopCommunityStatsJob } from './api/community/aggregator';
import { recalculateOvercountedMonthlyPremiums } from './api/insurance/hooks';
import { startSyncWorker, stopSyncWorker } from './api/providers/sync-worker';
import { app } from './app';
import './api/sync/init';
import { prepareDemoGarage } from './api/auth/demo';
import { discoverOidc } from './api/auth/providers/oidc';
import { CONFIG } from './config';
import { checkpointWAL, forceCheckpointWAL, runMigrations } from './db/connection';
import { validateTrustedProxies } from './utils/client-ip';
import { extractErrorMessage } from './utils/error-handling';
import { logger } from './utils/logger';

logger.startup(`VROOM Backend starting on ${CONFIG.server.host}:${CONFIG.server.port}`);
logger.startup(`Environment: ${CONFIG.env}`);

// Bun reports an address this machine does not own as a port conflict, not as a bad address.
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

try {
  validateTrustedProxies();
} catch (error) {
  logger.error(extractErrorMessage(error));
  process.exit(1);
}

// A db:push-bootstrapped database fails here with 'already exists'; see DatabaseMigrations.md.
try {
  await runMigrations();
} catch (error) {
  logger.error('Failed to run migrations on startup', {
    error,
    message: extractErrorMessage(error),
  });
  process.exit(1);
}

await discoverOidc();

try {
  await prepareDemoGarage();
} catch (error) {
  logger.error('Failed to prepare the demo garage', { message: extractErrorMessage(error) });
}

try {
  await recalculateOvercountedMonthlyPremiums();
} catch (error) {
  logger.error('Failed to recalculate monthly insurance premiums', {
    message: extractErrorMessage(error),
  });
}

const checkpointInterval = setInterval(
  () => {
    checkpointWAL();
  },
  CONFIG.env === 'development'
    ? CONFIG.database.checkpointIntervalDev
    : CONFIG.database.checkpointIntervalProd
);

forceCheckpointWAL();

startSyncWorker();

startCommunityStatsJob().catch((error) => {
  logger.error('Failed to start the community stats job', {
    message: extractErrorMessage(error),
  });
});

const shutdown = (signal: string) => {
  logger.shutdown(`Received ${signal}, shutting down gracefully...`);

  stopSyncWorker();
  stopCommunityStatsJob();

  clearInterval(checkpointInterval);

  forceCheckpointWAL();

  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default {
  port: CONFIG.server.port,
  // Bun binds every interface when no hostname is given, so HOST must always be passed through.
  hostname: CONFIG.server.host,
  fetch: app.fetch,
};
