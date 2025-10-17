#!/usr/bin/env bun

import { checkpointWAL, forceCheckpointWAL } from './connection.js';

// Manual checkpoint script
async function manualCheckpoint() {
  try {
    console.log('🔄 Running manual WAL checkpoint...');

    const force = process.argv.includes('--force');

    if (force) {
      console.log('⚡ Using FORCE mode (RESTART)...');
      forceCheckpointWAL();
    } else {
      console.log('📝 Using normal mode (TRUNCATE)...');
      checkpointWAL();
    }

    console.log('✅ Checkpoint completed successfully');
  } catch (error) {
    console.error('❌ Checkpoint failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.main) {
  await manualCheckpoint();
}
