#!/usr/bin/env bun

import { logger } from '../lib/utils/logger';
import { checkpointWAL, forceCheckpointWAL } from './connection.js';

// Manual checkpoint script
async function manualCheckpoint() {
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

// Run if called directly
if (import.meta.main) {
  await manualCheckpoint();
}
