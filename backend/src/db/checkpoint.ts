#!/usr/bin/env bun

import { logger } from '../utils/logger';
import { checkpointWAL, forceCheckpointWAL } from './connection.js';
import { ACTIVE_DIALECT } from './dialect/active.js';

export const NOT_ON_POSTGRES =
  'WAL checkpoints apply to SQLite only; this server uses Postgres, so there is nothing to do.';

async function manualCheckpoint() {
  if (ACTIVE_DIALECT !== 'sqlite') {
    logger.checkpoint(NOT_ON_POSTGRES);
    return;
  }
  try {
    logger.checkpoint('Running manual WAL checkpoint...');

    const force = process.argv.includes('--force');

    if (force) {
      logger.checkpoint('Using FORCE mode (RESTART)...');
      forceCheckpointWAL();
    } else {
      logger.checkpoint('Using normal mode (TRUNCATE)...');
      checkpointWAL();
    }

    logger.checkpoint('Checkpoint completed successfully');
  } catch (error) {
    logger.error('Checkpoint failed', { error });
    process.exit(1);
  }
}

if (import.meta.main) {
  await manualCheckpoint();
}
